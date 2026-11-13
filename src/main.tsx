import { CabiWindowLazy } from "./ui/cabinet/CabiWindowLazy";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./shared/fonts.css";
import "./shared/tokens.css";
import { applyPaletteCssVars } from "./shared/palette";
import { App } from "./ui/App";
import { FolderWindowApp } from "./ui/cabinet/FolderWindowApp";
import { CabinetWindowApp } from "./ui/cabinet/CabinetWindowApp";
import { PreviewApp } from "./ui/preview/PreviewApp";
import { loadAppProfile, type AppProfileInfo } from "./platform";

applyPaletteCssVars();

/** 별도 OS 창: folder = Cabinet 폴더 창, cabinet = Cabinet 창(improve-1102-spec C1) */
const win = new URLSearchParams(location.search).get("win");

/**
 * 실행 프로필을 먼저 묻는다(V2 6-B). Connected Preview는 기존 앱(App·Cabinet·폴더 창)을 그리지 않고
 * Preview 시작 화면만 — 기존 일지 열기·첫 실행·새 판 확인 흐름에 들어가지 않는다.
 */
function render(profile: AppProfileInfo) {
  const preview = profile.key === "connected-preview";
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Suspense fallback={null}>
        {preview ? (
          win ? null : (
            <PreviewApp profile={profile} />
          )
        ) : /* Cabinet 폴더 창(features-1102-spec F5) — 별도 OS 창이 같은 화면을 ?win=folder로 띄운다 */
        win === "cabi" ? (
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
}

void loadAppProfile().then(render);
