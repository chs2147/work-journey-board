import { defineConfig } from "vite";

// Tauri 개발 서버 규약: 고정 포트, 실패 시 다른 포트로 넘어가지 않음.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2021" },
});
