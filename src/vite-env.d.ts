/// <reference types="vite/client" />

/** package.json 버전(빌드 시 주입) */
declare const __APP_VERSION__: string;
/** 판 꼬리표(예: "Open Beta") — 없으면 빈 문자열. 정본 package.json `releaseLabel` */
declare const __APP_RELEASE_LABEL__: string;
/** 화면에 보이는 판: "1.50.0 Open Beta" — 꼬리표가 없으면 __APP_VERSION__과 같음 */
declare const __APP_VERSION_LABEL__: string;

/** sql.js WASM 바이트(base64) — vite.config.ts `sql-wasm-base64` 플러그인 */
declare module "virtual:sql-wasm-base64" {
  const base64: string;
  export default base64;
}
