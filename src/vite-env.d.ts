/// <reference types="vite/client" />

/** package.json 버전(빌드 시 주입) */
declare const __APP_VERSION__: string;

/** sql.js WASM 바이트(base64) — vite.config.ts `sql-wasm-base64` 플러그인 */
declare module "virtual:sql-wasm-base64" {
  const base64: string;
  export default base64;
}
