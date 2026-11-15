// D단계 내 온라인 공간 — Rust online_space.rs 명령(Preview 빌드에만 등록)
import { invoke } from "@tauri-apps/api/core";
import { tauriSpaceJournal } from "./tauriSpaceJournal";
import type { OnlineSpaceInfo, PreviewSpaces, SpaceSyncResult } from "./index";

const code = (e: unknown) => (typeof e === "string" && /^[A-Z0-9_]{3,60}$/.test(e) ? e : "UNKNOWN");
async function call<T>(cmd: string, args?: Record<string, unknown>) {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(code(e), { cause: e });
  }
}

export const tauriPreviewSpaces: PreviewSpaces = {
  list: () => call<{ workspaces: OnlineSpaceInfo[]; offline?: boolean }>("space_list"),
  sync: (workspaceId) => call<SpaceSyncResult>("space_sync", { workspaceId }),
  async read(workspaceId, name) {
    return new Uint8Array(await call<ArrayBuffer>("space_read", { workspaceId, name }));
  },
  remove: (workspaceId) => call<void>("space_remove", { workspaceId }),
  journal: tauriSpaceJournal,
  transport: {
    call: (action, params) => call<Record<string, unknown>>("space_sync_call", { action, params }),
    async uploadAsset(workspaceId, objectId, sha256, bytes) {
      try {
        await invoke("space_asset_upload", bytes, {
          headers: { "x-wjb-workspace": workspaceId, "x-wjb-object": objectId, "x-wjb-sha256": sha256 },
        });
      } catch (e) {
        throw new Error(code(e), { cause: e });
      }
    },
    async fetchAsset(workspaceId, objectId, sha256, bytes) {
      return new Uint8Array(
        await call<ArrayBuffer>("space_asset_fetch", { workspaceId, objectId, sha256, bytes }),
      );
    },
  },
};
