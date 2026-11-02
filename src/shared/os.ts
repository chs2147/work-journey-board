// 지금 어느 OS에서 도는가(macos-spec 3-2) — 화면 문구(단축키 표기·탐색기/Finder)와 플랫폼 계층만 쓴다.
// 화면 코드에서 이 값으로 동작을 가르지 않는다(동작 차이는 src/platform 뒤로만, CLAUDE.md 4-5).
// - 실앱: 웹뷰의 사용자 에이전트(윈도우 WebView2 = "Windows", 맥 WKWebView = "Macintosh")
// - 브라우저 모드: 기본은 윈도우 표기(스크린샷·E2E 기준), `?os=mac`이면 맥 표기(맥 문구 E2E·가이드 그림)

export type Os = "windows" | "macos";

export function detectOs(ua: string, search: string, tauri: boolean): Os {
  if (!tauri) return /[?&]os=mac(os)?\b/.test(search) ? "macos" : "windows";
  return /Macintosh|Mac OS X/.test(ua) ? "macos" : "windows";
}

const g = globalThis as {
  navigator?: { userAgent?: string };
  location?: { search?: string };
  isTauri?: boolean;
  __TAURI_INTERNALS__?: unknown;
};

/** 시작 때 한 번 정한다(모듈이 읽힐 때 — 문구가 모듈 상수라서) */
export const OS: Os = detectOs(
  g.navigator?.userAgent ?? "",
  g.location?.search ?? "",
  Boolean(g.isTauri || g.__TAURI_INTERNALS__),
);

export const isMac = OS === "macos";
