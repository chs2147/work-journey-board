/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import pkg from "./package.json";

// 실앱 CSP(tauri.conf.json)를 그대로 읽어, `vite preview`(E2E csp 프로젝트)에 같은 헤더를 건다.
// Tauri는 자체 <style>에 nonce를 붙인다 → nonce가 있으면 'unsafe-inline'이 무시되므로 같은 조건을 만들려고 가짜 nonce를 더한다.
const tauriCsp = (
  JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8")) as {
    app: { security: { csp: string } };
  }
).app.security.csp;
// 브라우저 모드에서만 쓰는 sql.js(WASM)를 위해 두 가지만 더 연다(실앱은 tauri-plugin-sql이라 필요 없음):
// WASM 파일 내려받기(connect-src 'self')와 WASM 컴파일('wasm-unsafe-eval'). 스타일 규칙은 실앱과 같다.
const PREVIEW_CSP = tauriCsp
  .replace("style-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' 'nonce-wjbTest'")
  .replace("connect-src ipc: http://ipc.localhost", "connect-src 'self' ipc: http://ipc.localhost")
  .concat("; script-src 'self' 'wasm-unsafe-eval'");

// Tauri 개발 서버 규약: 고정 포트, 실패 시 다른 포트로 넘어가지 않음.
export default defineConfig({
  plugins: [
    react(),
    // 스플래시 창(splash.html)의 버전 표시
    { name: "app-version-html", transformIndexHtml: (html) => html.replaceAll("%APP_VERSION%", pkg.version) },
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  preview: { port: 4173, strictPort: true, headers: { "Content-Security-Policy": PREVIEW_CSP } },
  // 페이지 2개: 앱(index.html) + 시작 스플래시 창(splash.html, docs/splash-spec.md)
  // ExcelJS(약 930 kB)는 내보내기를 처음 열 때만 불러오는 별도 조각이라 크기 경고 기준을 그에 맞춘다(i-m2-plan M2-S2)
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1000,
    rollupOptions: { input: { main: "index.html", splash: "splash.html" } },
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
  },
});
