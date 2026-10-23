// 전역 단축키(overview 10-2·10-3). 한국어 자판에서도 동작하도록 e.key 대신 e.code로 판별한다.
import { useEffect } from "react";
import { addDays, weekDays } from "../../domain/week";
import { goToday, goWeek, redo, setFocusDay, setYearOpen, undo, useBoard } from "./boardStore";

const isTyping = (el: Element | null) => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      const { ready, yearOpen, focusDay, weekId } = useBoard.getState();
      if (!ready) return;
      const mod = e.ctrlKey || e.metaKey;

      if (e.altKey && !mod && !e.shiftKey) {
        if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
          e.preventDefault();
          void goWeek(e.code === "ArrowLeft" ? -1 : 1);
        } else if (e.code === "KeyT") {
          e.preventDefault();
          void goToday();
        } else if (e.code === "KeyY") {
          e.preventDefault();
          setYearOpen(!yearOpen);
        }
        return;
      }
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
