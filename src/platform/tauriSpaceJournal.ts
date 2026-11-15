// E-1 온라인 공간 이 기기 일지 — Rust space_db.rs 명령(Preview 빌드에만 등록). 경로는 Rust가 정하고 여기서는 공간 ID만 넘긴다.
import { invoke } from "@tauri-apps/api/core";
import type { SqlParam, SqlStatement } from "../data/driver";
import type { SpaceDriver, SpaceJournalStore } from "./index";

/** SQL 오류는 SQLite 문구 그대로(앱이 파손·제약 오류를 문구로 가른다) */
async function call<T>(cmd: string, args: Record<string, unknown>, raw?: Uint8Array) {
  try {
    return raw
      ? await invoke<T>(cmd, raw, { headers: { "x-wjb-workspace": String(args.workspaceId) } })
      : await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : String(e), { cause: e });
  }
}

interface Rows {
  columns: string[];
  rows: unknown[][];
}

export const tauriSpaceJournal: SpaceJournalStore = {
  exists: (workspaceId) => call<boolean>("space_db_exists", { workspaceId }),
  create: (workspaceId, bytes) => call<void>("space_db_create", { workspaceId }, bytes),
  async open(workspaceId): Promise<SpaceDriver> {
    await call<void>("space_db_open", { workspaceId });
    return {
      label: "온라인 공간(이 기기)",
      async select<T>(sql: string, params: SqlParam[] = []) {
        const r = await call<Rows>("space_db_select", { workspaceId, sql, params });
        return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))) as T[];
      },
      async execute(sql: string, params: SqlParam[] = []) {
        return { changes: await call<number>("space_db_execute", { workspaceId, sql, params }) };
      },
      batch: (statements: SqlStatement[]) =>
        call<number>("space_db_batch", {
          workspaceId,
          statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
        }),
      async exportBytes() {
        return new Uint8Array(await call<ArrayBuffer>("space_db_export", { workspaceId }));
      },
      close: () => call<void>("space_db_close", { workspaceId }),
    };
  },
};
