// C-3 이관 통신 — Rust migration.rs 명령(Preview 빌드에만 등록). 그림은 IPC 원본 바이트로 넘긴다
import { invoke } from "@tauri-apps/api/core";
import type { MigrationJournal, PreviewMigration } from "./index";

const code = (e: unknown) => (typeof e === "string" && /^[A-Z0-9_]{3,60}$/.test(e) ? e : "UNKNOWN");
async function call<T>(
  cmd: string,
  args?: Parameters<typeof invoke>[1],
  options?: Parameters<typeof invoke>[2],
) {
  try {
    return await invoke<T>(cmd, args, options);
  } catch (e) {
    throw new Error(code(e), { cause: e });
  }
}

export const tauriPreviewMigration: PreviewMigration = {
  device: () => call<void>("migration_device"),
  command: (jobId, action, params) =>
    call<Record<string, unknown>>("migration_command", { jobId, action, params }),
  async putAsset(workspaceId, objectId, sha256, bytes) {
    await call("migration_put_asset", bytes, {
      headers: { "x-wjb-workspace": workspaceId, "x-wjb-object": objectId, "x-wjb-sha256": sha256 },
    });
  },
  async cancelAsset(workspaceId, objectId) {
    await call("migration_cancel_asset", { workspaceId, objectId });
  },
  journals: () => call<MigrationJournal[]>("migration_journal_list"),
  saveJournal: (journal) => call<void>("migration_journal_write", { journal }),
  removeJournal: (jobId) => call<void>("migration_journal_remove", { jobId }),
};
