// Connected Preview 계정 — Rust `online.rs` 명령(Preview 빌드에만 등록). 토큰은 화면으로 오지 않는다
import { invoke } from "@tauri-apps/api/core";
import type { OnlineStatus, PreviewOnline } from "./index";

const code = (e: unknown) => (typeof e === "string" && /^[A-Z_]{3,40}$/.test(e) ? e : "UNKNOWN");
const call = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(code(e), { cause: e });
  }
};

export const tauriPreviewOnline: PreviewOnline = {
  status: () => call<OnlineStatus>("online_status"),
  sendCode: (email) => call<void>("online_send_code", { email }),
  verifyCode: (email, c) => call<OnlineStatus>("online_verify_code", { email, code: c }),
  check: () => call<OnlineStatus>("online_check"),
  signOut: () => call<OnlineStatus>("online_sign_out"),
};
