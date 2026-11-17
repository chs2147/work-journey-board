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
import { loadAppProfile, setActiveProfile, type AppProfileInfo } from "./platform";

applyPaletteCssVars();

/** 별도 OS 창: folder = Cabinet 폴더 창, cabinet = Cabinet 창(improve-1102-spec C1) */
const win = new URLSearchParams(location.search).get("win");

/**
 * 실행 프로필을 먼저 묻는다(V2 6-B). Connected Preview는 기존 앱(App·Cabinet·폴더 창)을 그리지 않고
 * Preview 시작 화면만 — 기존 일지 열기·첫 실행·새 판 확인 흐름에 들어가지 않는다.
 */
async function render(profile: AppProfileInfo) {
  setActiveProfile(profile);
  // 비공식 판(Preview·DEV)은 화면 전체에 표시 — 타이틀 영역 색·DEV 배지(docs/release-channel-spec.md 5절)
  if (profile.unofficial) document.documentElement.dataset.channel = "dev";
  const preview = profile.key === "connected-preview";
  // 별도 창 화면(노트·메모보드 = cabi, 폴더, Cabi.NET 파일 목록) — Preview도 이것만 받고, 그 밖은 Preview 시작 화면
  const childWin = win === "cabi" || win === "folder" || win === "cabinet";
  // G-1 통합 앱(A안, docs/v2-design/98): DEV 메인 창은 이 PC 공간 + 온라인 공간을 한 앱에서(정식판은 그대로)
  if (profile.key === "local-dev" && !childWin) {
    const { installUnified } = await import("./ui/preview/UnifiedChrome");
    await installUnified();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Suspense fallback={null}>
        {preview && !childWin ? (
          <PreviewApp profile={profile} />
        ) : /* Preview 온라인 공간의 별도 창도 정식판과 같은 창 화면(자식 창은 DB를 열지 않고 메인 창이 읽어 줌, docs/v2-design/87) */
        /* Cabinet 폴더 창(features-1102-spec F5) — 별도 OS 창이 같은 화면을 ?win=folder로 띄운다 */
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
