// 시작 스플래시 창(tauri.conf.json의 "splash"). 메인 창은 숨긴 채 시작하고 finish()에서 보인다(src-tauri/src/splash.rs).
// 따로 둔 까닭: Connected Preview 시작 화면은 일지·SQLite 모듈 없이 이것만 가져간다(V2 6-B).
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import type { SplashWindow } from "./index";
import { SPLASH_STATUS_EVENT } from "./splashEvents";

let splashOpen = true;
export const splash: SplashWindow = {
  status(text) {
    if (splashOpen) void emitTo("splash", SPLASH_STATUS_EVENT, text).catch(() => undefined);
  },
  async finish() {
    splashOpen = false;
    await invoke("splash_finish");
  },
};
