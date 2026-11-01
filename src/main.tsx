import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./shared/fonts.css";
import "./shared/tokens.css";
import { applyPaletteCssVars } from "./shared/palette";
import { App } from "./ui/App";
import { FolderWindowApp } from "./ui/cabinet/FolderWindowApp";

applyPaletteCssVars();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Cabinet 폴더 창(features-1102-spec F5) — 별도 OS 창이 같은 화면을 ?win=folder로 띄운다 */}
    {new URLSearchParams(location.search).get("win") === "folder" ? <FolderWindowApp /> : <App />}
  </StrictMode>,
);
