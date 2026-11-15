// C-2 원본 일지 읽기 전용 사본 — Rust source_copy.rs 명령(Preview 빌드에만 등록)
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { PreviewSource, SourceSnapshot } from "./index";

const code = (e: unknown) => (typeof e === "string" && /^[A-Z_]{3,40}$/.test(e) ? e : "UNKNOWN");
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(code(e), { cause: e });
  }
}

export const tauriPreviewSource: PreviewSource = {
  async pickFolder(title) {
    const p = await open({ directory: true, multiple: false, title });
    return typeof p === "string" ? p : null;
  },
  candidates: (dir) => call<string[]>("source_candidates", { dir }),
  snapshot: (dir) => call<SourceSnapshot>("source_snapshot", { dir }),
  async read(snapshotId) {
    const raw = await call<ArrayBuffer>("source_snapshot_read", { snapshotId });
    return new Uint8Array(raw);
  },
  remove: (snapshotId) => call<void>("source_snapshot_remove", { snapshotId }),
};
