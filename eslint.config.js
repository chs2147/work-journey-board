import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: ["dist", "m0", "src-tauri/target", "src-tauri/gen", "playwright-report", "test-results", "site"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // 디자인 시점 도구(scripts/brand) — Node에서 실행
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // 외부 통신 0 원칙(CLAUDE.md 4-1): 앱 코드에서 네트워크 API 사용 금지.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "외부 통신 0 원칙: fetch 사용 금지 (CLAUDE.md 4-1)" },
        { name: "XMLHttpRequest", message: "외부 통신 0 원칙: XMLHttpRequest 사용 금지" },
        { name: "WebSocket", message: "외부 통신 0 원칙: WebSocket 사용 금지" },
        { name: "EventSource", message: "외부 통신 0 원칙: EventSource 사용 금지" },
      ],
    },
  },
);
