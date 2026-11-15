// D-3 온라인 공간 되살리기(Connected Preview, docs/v2-design/87) — 이 기기 캐시(머리·기록·그림 파일) → 앱 일지 바이트.
// E-1부터는 이 바이트로 이 기기 일지를 처음 한 번 만든다(spaceJournal.ts). 원본 로컬 일지·정식판·DEV와 무관.
import type { SqlJsStatic } from "sql.js";
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
    return { bytes: db.export(), head, records: records.length, list: records };
  } finally {
    db.close();
  }
}
