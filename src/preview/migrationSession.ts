// C-4 이관 준비(Connected Preview, docs/v2-design/85) — 원본 사본 → sql.js → 이관 자료.
// 작업 ID에서 공간·그림 객체 ID를 정해진 규칙으로 만든다: 앱을 다시 켜도 같은 사본이면 같은 자료(같은 mappingHash)라
// 끊긴 작업을 이어 갈 수 있다. sql.js는 이 단계에서만 불러온다(Preview 시작 화면은 불러오지 않음).
import type { PreviewSource } from "../platform";
import { sha256Hex } from "../../poc/v2-sync/hash-core.mjs";
import { prepareCopy, type PreparedCopy } from "./migrationEngine";

const utf8 = new TextEncoder();
/** 작업 ID·이름 → v4 모양 UUID(정해진 값) */
export function derivedId(jobId: string, name: string) {
  const h = sha256Hex(utf8.encode(`wjb-c4:${jobId}:${name}`));
  const v = ((parseInt(h[16]!, 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface CopySummary {
  sourceSchema: number;
  records: number;
  entries: number;
  categories: number;
  images: number;
  imageBytes: number;
  pages: number;
  excluded: number;
}
export function summarize(p: PreparedCopy): CopySummary {
  const stats = p.header.tableStats as Record<string, { mappedRows: number } | undefined>;
  return {
    sourceSchema: p.header.sourceSchema,
    records: p.recordsTotal,
    entries: stats.entry_item?.mappedRows ?? 0,
    categories: stats.category?.mappedRows ?? 0,
    images: p.assets.length,
    imageBytes: p.assets.reduce((n, a) => n + a.bytes, 0),
    pages: p.pages.length,
    excluded: p.header.exclusions.length,
  };
}

let sql: Promise<import("sql.js").SqlJsStatic> | null = null;
/**
 * sql.js 불러오기 — WebAssembly 바이트를 코드에 넣어(vite.config.ts `sql-wasm-base64`) 직접 넘긴다.
 * Preview 화면 CSP는 `connect-src`가 앱 내부 통신뿐이라 wasm 파일을 fetch로 받을 수 없다(C-5 실기에서 발견).
 * 접속 범위는 넓히지 않는다 — 컴파일만 `script-src 'wasm-unsafe-eval'`.
 */
export async function loadSql() {
  sql ??= Promise.all([import("sql.js"), import("virtual:sql-wasm-base64")]).then(([m, w]) => {
    const bin = atob(w.default);
    const wasmBinary = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) wasmBinary[i] = bin.charCodeAt(i);
    return m.default({ wasmBinary: wasmBinary.buffer });
  });
  return sql;
}

/** 사본을 읽어 이관 자료를 만든다(쓰기 없음). 같은 작업 ID·같은 사본이면 결과가 같다 */
export async function prepareFromSnapshot(source: PreviewSource, snapshotId: string, jobId: string) {
  const [SQL, bytes] = await Promise.all([loadSql(), source.read(snapshotId)]);
  let n = 0;
  return prepareCopy(SQL, bytes, {
    workspaceId: derivedId(jobId, "workspace"),
    sourceWorkspaceId: derivedId(jobId, "source"),
    randomUUID: () => derivedId(jobId, `object-${++n}`),
  });
}
