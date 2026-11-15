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

/** 구조를 바꾸는 문(행 수로 잡히지 않음)은 늘 거절 — VACUUM INTO(백업 사본)는 일지를 바꾸지 않는다 */
const DDL = /^\s*(create|drop|alter|reindex|vacuum(?!\s+into)|pragma\s+\w+\s*=)/i;
export class OnlineReadOnlyError extends Error {
  constructor() {
    super("ONLINE_READ_ONLY");
  }
}
/**
 * 앱이 공간을 다 띄운 뒤(lock)부터 **실제로 내용을 바꾸는 쓰기**를 거절하는 드라이버(바뀌면 되돌리고 오류).
 * "없으면 만들기(INSERT OR IGNORE)"처럼 바뀌는 게 없는 문은 그대로 통과 — 메모보드 열기 등이 막히지 않게(실기에서 발견).
 * 메모리 위 sql.js 연결 하나라 저장점으로 감싸 판정한다. 편집·동기화는 E단계.
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
      const total = async () => (await d.select<{ n: number }>("SELECT total_changes() AS n"))[0]?.n ?? 0;
      const refuse = () => {
        onBlocked?.();
        return new OnlineReadOnlyError();
      };
      async function guarded(sqls: { sql: string; params?: unknown[] }[]) {
        if (sqls.some((s) => DDL.test(s.sql))) throw refuse();
        await d.execute("SAVEPOINT wjb_online_ro");
        let changes = 0,
          ok = false;
        try {
          const before = await total();
          for (const s of sqls) changes += (await d.execute(s.sql, s.params as never)).changes;
          ok = (await total()) === before;
        } finally {
          if (!ok) await d.execute("ROLLBACK TO wjb_online_ro");
          await d.execute("RELEASE wjb_online_ro");
        }
        if (!ok) throw refuse();
        return changes;
      }
      return {
        label: "온라인 공간(읽기 전용)",
        select: (sql, params) => d.select(sql, params),
        async execute(sql, params) {
          if (!locked) return d.execute(sql, params);
          if (/^\s*vacuum\s+into/i.test(sql)) return d.execute(sql, params);
          return { changes: await guarded([{ sql, params }]) };
        },
        async batch(statements) {
          if (!locked) return d.batch(statements);
          return guarded(statements);
        },
        close: () => d.close(),
      };
    },
  };
}
