// D-3 온라인 공간 되살리기(Connected Preview, docs/v2-design/87) — 이 기기 캐시(머리·기록·그림 파일) → 메모리 안 앱 일지.
// 되살린 일지는 메모리에만 있다(파일로 쓰지 않음). 원본 로컬 일지·정식판·DEV와 무관.
import type { SqlJsStatic } from "sql.js";
import type { SqlDriver } from "../data/driver";
import type { PreviewSpaces } from "../platform";
import { bytesToBase64, hash } from "../../poc/v2-sync/hash-core.mjs";
import type {
  MappedAsset,
  MappedRecord,
  WorkspaceEnvelope,
} from "../../poc/v2-migration/workspace-map-core.mjs";
import { createWorkspaceRestorer } from "../../poc/v2-migration/workspace-restore-core.mjs";
import { emptyJournal, readOnlyAdapter } from "./migrationEngine";

export interface CachedHeader {
  workspaceId: string;
  manifestHash: string;
  createdAt: string | null;
  header: Omit<WorkspaceEnvelope, "records" | "assets">;
  assets: MappedAsset[];
}

const json = <T>(bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes)) as T;

/** 캐시 → 앱 일지 바이트(SQLite 파일 모양, 메모리). 그림은 해시를 확인한 뒤 base64로 일지 안에 */
export async function restoreFromCache(SQL: SqlJsStatic, spaces: PreviewSpaces, workspaceId: string) {
  const head = json<CachedHeader>(await spaces.read(workspaceId, "header.json"));
  const records = json<MappedRecord[]>(await spaces.read(workspaceId, "records.json"));
  const files = new Map<string, Uint8Array>();
  for (const a of head.assets)
    if (!files.has(a.sha256)) files.set(a.sha256, await spaces.read(workspaceId, `${a.sha256}.bin`));
  const bySha = new Map(head.assets.map((a) => [a.objectId, a.sha256]));
  const restorer = createWorkspaceRestorer({ hash, bytesToBase64 });
  const header = { ...head.header, assets: head.assets } as Omit<WorkspaceEnvelope, "records">;
  const rows = restorer.toRows({ header, records }, (id) => files.get(bySha.get(id) ?? ""));
  const db = emptyJournal(SQL, header.sourceSchema);
  try {
    const r = readOnlyAdapter(db);
    restorer.writeInto(
      {
        prepare: (sql) => ({
          all: (...p) => r.prepare(sql).all(...p),
          run: (...p) => db.run(sql, p as never),
        }),
        exec: (sql) => db.exec(sql),
      },
      rows,
    );
    return { bytes: db.export(), head, records: records.length };
  } finally {
    db.close();
  }
}

/** 읽기 전용 문(조회·백업 사본) 외 쓰기를 막는 문장 판정 — VACUUM INTO(백업 사본)는 일지를 바꾸지 않는다 */
const WRITE =
  /^\s*(insert|update|delete|replace|create|drop|alter|reindex|vacuum(?!\s+into)|pragma\s+\w+\s*=)/i;
export class OnlineReadOnlyError extends Error {
  constructor() {
    super("ONLINE_READ_ONLY");
  }
}
/**
 * 앱이 공간을 다 띄운 뒤(lock)부터 쓰기를 거절하는 드라이버. 띄우는 동안의 설정 정리 쓰기는 메모리 일지에만 간다.
 * 편집·동기화는 E단계 — 지금은 화면에 "읽기 전용" 띠와 안내.
 */
export function readOnlyGate(onBlocked?: () => void) {
  let locked = false;
  return {
    lock() {
      locked = true;
    },
    get locked() {
      return locked;
    },
    wrap(d: SqlDriver): SqlDriver {
      const check = (sql: string) => {
        if (locked && WRITE.test(sql)) {
          onBlocked?.();
          throw new OnlineReadOnlyError();
        }
      };
      return {
        label: "온라인 공간(읽기 전용)",
        select: (sql, params) => d.select(sql, params),
        async execute(sql, params) {
          check(sql);
          return d.execute(sql, params);
        },
        async batch(statements) {
          for (const s of statements) check(s.sql);
          return d.batch(statements);
        },
        close: () => d.close(),
      };
    },
  };
}
