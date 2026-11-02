// 문구의 OS 표기(macos-spec 3-2). 문구 원본(strings.ts)은 한 벌 — 윈도우 표기로 쓰고, 맥에서는 읽힐 때 한 번 바꾼다.
// - 단축키: `Ctrl+Shift+F` → `⇧⌘F`, `Alt+M` → `⌥M`, `Ctrl+클릭` → `⌘+클릭`(맥 표준 순서 ⌃⌥⇧⌘)
// - 낱말: 탐색기 → Finder, 윈도우 설정 → macOS 설정, 바로 가기 → 가상본, 캡처 키 Win+Shift+S → ⇧⌘4
// 동작(키 판정)은 바꾸지 않는다 — 판정은 이미 Ctrl·⌘을 함께 받는다(e.ctrlKey || e.metaKey).
import { OS, type Os } from "./os";

const MOD_SYMBOL: Record<string, string> = { Ctrl: "⌘", Alt: "⌥", Shift: "⇧" };
/** 맥 표준 순서: ⌃ ⌥ ⇧ ⌘ */
const MOD_ORDER = ["⌃", "⌥", "⇧", "⌘"];
const KEY_SYMBOL: Record<string, string> = {
  Enter: "↩",
  Delete: "⌦",
  Backspace: "⌫",
  Tab: "⇥",
};

// 수식키 묶음 + 키 하나. 키 = F1~F12 · 이름 있는 키 · 화살표(←/→ 꼴 포함) · 글자·숫자·기호 하나 · 한글 낱말(클릭·휠)
const COMBO =
  /\b((?:(?:Ctrl|Alt|Shift)\+)+)(F\d{1,2}(?!\d)|Enter|Delete|Backspace|Tab|Esc|[←→↑↓](?:\/[←→↑↓])?|[A-Z0-9](?![A-Za-z0-9])|[-=,.[\]/]|[가-힣]+)/g;

function macCombo(mods: string, key: string): string {
  const syms = mods
    .split("+")
    .filter(Boolean)
    .map((m) => MOD_SYMBOL[m] ?? m);
  const ordered = MOD_ORDER.filter((s) => syms.includes(s)).join("");
  // 한글 낱말(클릭·휠)은 기호에 바로 붙이면 읽기 어려워 + 를 둔다
  if (/^[가-힣]/.test(key)) return `${ordered}+${key}`;
  return ordered + (KEY_SYMBOL[key] ?? key);
}

/** 윈도우 표기 문구 → 맥 표기 */
export function macText(s: string): string {
  return (
    s
      .replace(/Win\+Shift\+S/g, "⇧⌘4")
      .replace(COMBO, (_, mods: string, key: string) => macCombo(mods, key))
      // 수식키 없이 홀로 쓴 Delete(상자·관계선 지우기) = 맥 키보드의 delete(⌫)
      .replace(/(^|[\s(·])Delete(?=$|[\s)·])/g, "$1⌫")
      .replace(/윈도우 설정 › 개인 설정 › 색 › 앱 모드/g, "macOS 시스템 설정 › 화면 모드")
      .replace(/윈도우 설정/g, "macOS 설정")
      .replace(/윈도우가/g, "macOS가")
      .replace(/탐색기에서 열기/g, "Finder에서 보기")
      .replace(/탐색기/g, "Finder")
      .replace(/바로 가기가/g, "가상본이")
      .replace(/바로 가기/g, "가상본")
      // 맥은 OneDrive 말고도 iCloud·Google Drive·Dropbox 동기화 폴더를 같은 경고로 본다(macos-spec 3-3)
      .replace(/OneDrive 동기화 폴더/g, "클라우드 동기화 폴더(OneDrive·iCloud 등)")
      .replace(/OneDrive 폴더/g, "동기화 폴더")
  );
}

/** 지금 OS 표기로 */
export function osText(s: string, os: Os = OS): string {
  return os === "macos" ? macText(s) : s;
}

/** 문구 묶음 전체를 OS 표기로(글은 바꾸고, 글을 돌려주는 함수는 결과를 바꾼다). 윈도우면 그대로 돌려준다 */
export function localizeTree<T>(tree: T, os: Os = OS): T {
  if (os !== "macos") return tree;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return macText(v);
    if (typeof v === "function")
      return (...args: unknown[]) => walk((v as (...a: unknown[]) => unknown)(...args));
    if (v && typeof v === "object" && !Array.isArray(v))
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    if (Array.isArray(v)) return v.map(walk);
    return v;
  };
  return walk(tree) as T;
}
