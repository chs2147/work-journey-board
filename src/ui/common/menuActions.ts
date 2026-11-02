// 맥 메뉴 막대(macos-spec 3-1)의 항목 → 웹 화면 동작. 메뉴(Rust menu.rs)는 이벤트 이름만 보내고,
// 할 일은 키보드 단축키 처리(useShortcuts)와 같은 길로 보낸다 — 단축키와 메뉴가 늘 같은 동작이 되게. 윈도우에는 메뉴가 없다.
import type { Platform } from "../../platform";
import { STR } from "../../shared/strings";

const KEYS: Record<string, KeyboardEventInit> = {
  settings: { code: "Comma", key: ",", metaKey: true },
  board: { code: "Digit1", key: "1", altKey: true },
  important: { code: "Digit2", key: "2", altKey: true },
  insights: { code: "Digit3", key: "3", altKey: true },
  cabinet: { code: "Digit4", key: "4", altKey: true },
};

export function runMenuAction(id: string, platform: Platform | null) {
  if (id === "guide") {
    void platform?.openUrl(STR.settings.guideUrl);
    return;
  }
  const init = KEYS[id];
  if (init) window.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
}
