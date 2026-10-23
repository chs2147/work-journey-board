import type { Platform } from "./index";

// 실앱: 저장 폴더 설정(config.json)·첫 실행은 S4에서 연결한다. 그 전까지는 "미설정"으로 동작.
export const tauriPlatform: Platform = {
  kind: "tauri",
  openJournal: async () => null,
};
