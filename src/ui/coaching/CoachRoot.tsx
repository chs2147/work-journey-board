// 코칭 한 곳에서 붙이기(coaching-spec 7절) — 오버레이·메뉴·카드·F1. App에 한 번.
import { useEffect } from "react";
import { useAppStore } from "../common/appStore";
import { CoachCards } from "./CoachCards";
import { CoachMenu } from "./CoachMenu";
import { CoachOverlay } from "./CoachOverlay";
import { toggleMenu, useCoaching, wireCoaching } from "./coachingStore";

// 첫 실행 화면을 거쳤는지 보려면 앱 시작(start)보다 먼저 연결돼야 한다 — 모듈을 불러올 때 바로
wireCoaching();

export function CoachRoot() {
  const ready = useAppStore((s) => s.journal.state === "ready");
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "F1" || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      if (useCoaching.getState().phase === "idle") toggleMenu();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <>
      {ready && <CoachMenu />}
      {ready && <CoachCards />}
      <CoachOverlay />
    </>
  );
}
