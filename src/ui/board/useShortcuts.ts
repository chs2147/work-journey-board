// 전역 단축키(overview 10-2·10-3). 한국어 자판에서도 동작하도록 e.key 대신 e.code로 판별한다.
import { useEffect } from "react";
import { addDays, weekDays } from "../../domain/week";
import {
  focusStartCell,
  goToday,
  goDay,
  goWeek,
  pullPreviousDay,
  setViewMode,
  redo,
  setFocusDay,
  setPanelOpen,
  setYearOpen,
  undo,
  useBoard,
} from "./boardStore";
import { toggleExport, useExport } from "../export/exportStore";
import { toggleSummary } from "../summary/summaryStore";
import { focusNote, leaveNote } from "../note/noteStore";
import { closeInsights, focusedCategory, openInsights, useInsights } from "../insights/insightsStore";
import { leaveSettings, setSettingsOpen } from "../common/appController";
import { useAppStore } from "../common/appStore";

const isTyping = (el: Element | null) => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      const { ready, yearOpen, focusDay, weekId, panelOpen, viewMode } = useBoard.getState();
      if (!ready) return;
      const mod = e.ctrlKey || e.metaKey;
      const insights = useInsights.getState().open;
      const settings = useAppStore.getState().settingsOpen;

      // 설정(improve-1027v5-spec 1-2): Ctrl+, = 열기/닫기. 보이는 동안은 Alt+1·2·3(다른 화면으로)만 받는다
      if (mod && !e.altKey && !e.shiftKey && e.code === "Comma") {
        e.preventDefault();
        if (settings) leaveSettings();
        else setSettingsOpen(true);
        return;
      }
      if (settings) {
        if (e.altKey && !mod && !e.shiftKey && ["Digit1", "Digit2", "Digit3"].includes(e.code)) {
          e.preventDefault();
          setSettingsOpen(false);
          if (e.code === "Digit1") {
            closeInsights();
            focusStartCell();
          } else if (e.code === "Digit2") setPanelOpen(true, true);
          else if (!insights) void openInsights(focusedCategory());
        }
        return;
      }

      // 인사이트(m3-s1-spec 10절): Alt+3 = 열기(칸의 업무)/보드로, Alt+1 = 보드로. 보이는 동안 보드 단축키는 쉰다
      if (e.altKey && !mod && !e.shiftKey && e.code === "Digit3") {
        e.preventDefault();
        if (insights) {
          closeInsights();
          focusStartCell();
        } else void openInsights(focusedCategory());
        return;
      }
      if (insights) {
        if (e.altKey && !mod && !e.shiftKey && e.code === "Digit1") {
          e.preventDefault();
          closeInsights();
          focusStartCell();
        } else if (e.altKey && !mod && !e.shiftKey && e.code === "Digit2") {
          e.preventDefault();
          setPanelOpen(!panelOpen, !panelOpen);
        }
        return;
      }

      // 내보내기 대화상자가 열려 있으면 Alt+E(닫기) 말고는 보드 단축키를 받지 않는다
      if (useExport.getState().open) {
        if (e.altKey && !mod && !e.shiftKey && e.code === "KeyE") {
          e.preventDefault();
          toggleExport();
        }
        return;
      }
      // 직전 기록일 업무 전체 가져오기(improve-1026-spec 3-2) — 포커스 열에
      if (e.altKey && !mod && e.shiftKey && e.code === "KeyP") {
        if ((e.target as Element | null)?.closest?.("[data-note-root]")) return;
        e.preventDefault();
        void pullPreviousDay(focusDay);
        return;
      }
      if (e.altKey && !mod && !e.shiftKey) {
        if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
          e.preventDefault();
          // 오늘 뷰는 하루씩, 주간 뷰는 한 주씩(improve-1026-spec 8-1)
          if (viewMode === "today") void goDay(e.code === "ArrowLeft" ? -1 : 1);
          else void goWeek(e.code === "ArrowLeft" ? -1 : 1);
        } else if (e.code === "KeyV") {
          e.preventDefault();
          setViewMode(viewMode === "today" ? "week" : "today");
        } else if (e.code === "KeyT") {
          e.preventDefault();
          void goToday();
        } else if (e.code === "KeyY") {
          e.preventDefault();
          setYearOpen(!yearOpen);
        } else if (e.code === "Digit1") {
          // 주간 보드 보기(important-repeat-spec 5절) — 지금은 보기가 보드 하나라 보드로 커서를 돌려보낸다
          e.preventDefault();
          focusStartCell();
        } else if (e.code === "Digit2") {
          e.preventDefault();
          setPanelOpen(!panelOpen, !panelOpen);
        } else if (e.code === "KeyE") {
          // 엑셀 내보내기(i-m2-plan M2-S2)
          e.preventDefault();
          toggleExport();
        } else if (e.code === "KeyM") {
          // 메모로 가기 / 메모에서 보드로(weekly-note-spec 4-6)
          e.preventDefault();
          const inNote = (document.activeElement as Element | null)?.closest("[data-note-root]");
          if (inNote) leaveNote();
          else focusNote();
        } else if (e.code === "KeyS") {
          // 주간 요약 패널(i-m2-plan M2-S1) — 열면 패널로 포커스
          e.preventDefault();
          toggleSummary(true);
        }
        return;
      }
      // 메모 안의 실행 취소는 메모(편집기·상자 기록)가 맡는다 — 보드 실행 취소로 가지 않게
      if (mod && (e.target as Element | null)?.closest?.("[data-note-root]")) return;
      if (mod && !e.altKey) {
        if (e.code === "KeyZ") {
          e.preventDefault();
          void (e.shiftKey ? redo() : undo());
        } else if (e.code === "KeyY" && !e.shiftKey) {
          e.preventDefault();
          void redo();
        } else if ((e.code === "ArrowLeft" || e.code === "ArrowRight") && !isTyping(document.activeElement)) {
          e.preventDefault();
          const days = weekDays(weekId);
          const next = addDays(focusDay, e.code === "ArrowLeft" ? -1 : 1);
          if (days.includes(next)) setFocusDay(next);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
