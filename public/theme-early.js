// 화면 테마를 페이지가 그려지기 전에 정한다(improve-1027v5-spec 4-2·4-3) — 메인 창·시작 창 <head>에서 동기 실행.
// 규칙은 src/shared/theme.ts의 readStoredTheme + resolveTheme와 같다(tests/unit/theme.test.ts가 대조). 네트워크 없음.
/* global window, document, localStorage */
(function () {
  var pref = "signature"; // 처음 설치 기본값(release-phase2-spec 1절)
  try {
    var v = localStorage.getItem("wjb.theme");
    if (v === "light" || v === "dark" || v === "system" || v === "signature") pref = v;
  } catch {
    // 읽을 수 없으면 기본값
  }
  var dark =
    pref === "dark" ||
    (pref === "system" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute(
    "data-theme",
    pref === "signature" ? "signature" : dark ? "dark" : "light",
  );
})();
