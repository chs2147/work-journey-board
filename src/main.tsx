import { CabiWindowLazy } from "./ui/cabinet/CabiWindowLazy";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./shared/fonts.css";
import "./shared/tokens.css";
import { applyPaletteCssVars } from "./shared/palette";
import { App } from "./ui/App";
import { FolderWindowApp } from "./ui/cabinet/FolderWindowApp";
import { CabinetWindowApp } from "./ui/cabinet/CabinetWindowApp";

applyPaletteCssVars();

/** 별도 OS 창: folder = Cabinet 폴더 창, cabinet = Cabinet 창(improve-1102-spec C1) */
const win = new URLSearchParams(location.search).get("win");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      {/* Cabinet 폴더 창(features-1102-spec F5) — 별도 OS 창이 같은 화면을 ?win=folder로 띄운다 */}
      {win === "cabi" ? (
        <CabiWindowLazy />
      ) : win === "folder" ? (
        <FolderWindowApp />
      ) : win === "cabinet" ? (
        <CabinetWindowApp />
      ) : (
        <App />
      )}
    </Suspense>
  </StrictMode>,
);
