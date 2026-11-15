// C-3 이관 엔진(Connected Preview, docs/v2-design/84) — 원본 일지 사본 바이트 → 온라인 이관 자료.
// 규칙은 PoC와 같은 순수 핵심을 그대로 쓴다(복사본을 두지 않음): 읽기 검사·이미지 분리 copy-core,
// 온라인 형식 바꾸기 workspace-map-core, 해시 hash-core. 이 모듈은 네트워크를 쓰지 않는다.
import type { Database, SqlJsStatic } from "sql.js";
import { createCopyCore, type ReadDb } from "../../poc/v2-assets/copy-core.mjs";
import { base64ToBytes, bytesToBase64, hash } from "../../poc/v2-sync/hash-core.mjs";
import {
  createWorkspaceMapper,
  type MappedAsset,
  type MappedRecord,
  type WorkspaceEnvelope,
} from "../../poc/v2-migration/workspace-map-core.mjs";
import { SECTION_ICONS } from "../shared/sectionIcons";

/** 서버 계약(SQL 010·gateway)의 한도 — 넘으면 보내기 전에 멈춘다 */
export const LIMITS = Object.freeze({
  pageRows: 1000,
  pages: 32,
  records: 20000,
  /** gateway 본문 한도 1,100,000바이트에서 머리·여유를 뺀 페이지 기록 예산 */
  pageBytes: 1_000_000,
  headerBytes: 1_000_000,
  assets: 2000,
  assetBytes: 10 * 1024 * 1024,
  totalAssetBytes: 200 * 1024 * 1024,
});

const migrationSql = import.meta.glob("../data/migrations/00*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** sql.js 연결을 node:sqlite처럼(prepare().get/all) — 읽기만 */
export function readOnlyAdapter(db: Database): ReadDb {
  return {
    prepare(sql) {
      const run = (params: unknown[], one: boolean) => {
        const st = db.prepare(sql);
        try {
          if (params.length) st.bind(params as never);
          const out: Record<string, unknown>[] = [];
          while (st.step()) {
            out.push(st.getAsObject() as Record<string, unknown>);
            if (one) break;
          }
          return out;
        } finally {
          st.free();
        }
      };
      return { get: (...p) => run(p, true)[0], all: (...p) => run(p, false) };
    },
  };
}

const migrationFiles = () =>
  Object.entries(migrationSql)
    .map(([path, sql]) => [path.split("/").pop() ?? "", sql] as const)
    .filter(([name]) => /^00\d\d_.*\.sql$/.test(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** 제품 마이그레이션만 적용한 빈 일지(그 판) — 원본 구조 비교와 온라인 공간 되살리기(D-3)에 쓴다 */
export function emptyJournal(SQL: SqlJsStatic, version: number): Database {
  const db = new SQL.Database();
  for (const [name, sql] of migrationFiles()) if (Number(name.slice(0, 4)) <= version) db.exec(sql);
  db.run("INSERT INTO app_meta(key,value) VALUES('schema_version',?)", [String(version)]);
  return db;
}

/** 제품 마이그레이션만 적용한 빈 DB의 구조(원본 구조가 의미상 같아야 한다) */
function expectedSchemaFor(SQL: SqlJsStatic, core: ReturnType<typeof createCopyCore>) {
  const cache = new Map<number, unknown>();
  return (version: number) => {
    if (!cache.has(version)) {
      const db = emptyJournal(SQL, version);
      try {
        cache.set(version, core.schemaModel(readOnlyAdapter(db)));
      } finally {
        db.close();
      }
    }
    return cache.get(version) as Record<string, unknown>;
  };
}

export interface PreparedCopy {
  workspaceId: string;
  sourceHash: string;
  mappingHash: string;
  /** upload_begin 머리(기록 없는 봉투) */
  header: Omit<WorkspaceEnvelope, "records">;
  pages: MappedRecord[][];
  recordsTotal: number;
  assets: MappedAsset[];
  /** 그림 바이트(objectId → 바이트). 메모리에만 — 기록 파일·화면 상태에 넣지 않는다 */
  assetBytes: Map<string, Uint8Array>;
}

export class CopyLimitError extends Error {}

const utf8 = new TextEncoder();
/**
 * 페이지 나누기(서버 013, D-a): 한 페이지 ≤1,000행이면서 직렬화 ≤pageBytes. 한 기록이 예산보다 크면 보내기 전에 멈춘다.
 * 순서는 봉투 기록 순서 그대로(서버가 페이지 순서로 다시 잇는다).
 */
export function paginate(records: MappedRecord[], pageBytes: number = LIMITS.pageBytes) {
  if (!records.length || records.length > LIMITS.records) throw new CopyLimitError("COPY_TOO_LARGE");
  const pages: MappedRecord[][] = [];
  let page: MappedRecord[] = [],
    size = 2; // "[]"
  for (const r of records) {
    const n = utf8.encode(JSON.stringify(r)).length + 1; // 쉼표
    if (n + 2 > pageBytes) throw new CopyLimitError("RECORD_TOO_LARGE");
    if (page.length && (page.length >= LIMITS.pageRows || size + n > pageBytes)) {
      pages.push(page);
      page = [];
      size = 2;
    }
    page.push(r);
    size += n;
  }
  pages.push(page);
  if (pages.length > LIMITS.pages) throw new CopyLimitError("COPY_TOO_LARGE");
  return pages;
}

/**
 * 사본 바이트를 sql.js로 열어 읽기 검사 → 이미지 분리 → 온라인 형식 봉투 → 페이지.
 * 원본 파일은 이미 Rust가 읽기 전용으로 떠 둔 사본이며, 여기서도 쓰지 않는다.
 */
export function prepareCopy(
  SQL: SqlJsStatic,
  snapshot: Uint8Array,
  {
    workspaceId,
    sourceWorkspaceId,
    randomUUID = () => crypto.randomUUID(),
    pageBytes = LIMITS.pageBytes,
  }: { workspaceId: string; sourceWorkspaceId: string; randomUUID?: () => string; pageBytes?: number },
): PreparedCopy {
  const core = createCopyCore({ hash, randomUUID, base64ToBytes, bytesToBase64 });
  const mapper = createWorkspaceMapper({ hash, sectionIconIds: new Set(SECTION_ICONS.map((i) => i.id)) });
  const sourceHash = hash(snapshot);
  const db = new SQL.Database(snapshot);
  let rows;
  try {
    rows = core.captureRows(readOnlyAdapter(db), {
      allowNoteImages: true,
      expectedSchema: expectedSchemaFor(SQL, core),
    });
  } finally {
    db.close();
  }
  const copy = core.extractCopy({ sourceHash, rows }, { workspaceId, sourceWorkspaceId });
  const { envelope, mappingHash } = mapper.mapCopy(copy, workspaceId);
  const { records, ...header } = envelope;
  if (utf8.encode(JSON.stringify(header)).length > LIMITS.headerBytes)
    throw new CopyLimitError("COPY_TOO_LARGE");
  const total = envelope.assets.reduce((n, a) => n + a.bytes, 0);
  if (
    envelope.assets.length > LIMITS.assets ||
    envelope.assets.some((a) => a.bytes > LIMITS.assetBytes) ||
    total > LIMITS.totalAssetBytes
  )
    throw new CopyLimitError("ASSET_LIMIT");
  const bySha = copy.blobBytes;
  const assetBytes = new Map<string, Uint8Array>();
  for (const a of envelope.assets) {
    const bytes = bySha.get(a.sha256);
    if (!bytes || bytes.length !== a.bytes) throw new Error("BLOB_REFERENCE");
    assetBytes.set(a.objectId, bytes);
  }
  return {
    workspaceId,
    sourceHash,
    mappingHash,
    header,
    pages: paginate(records, pageBytes),
    recordsTotal: records.length,
    assets: envelope.assets,
    assetBytes,
  };
}
