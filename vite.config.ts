/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

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
