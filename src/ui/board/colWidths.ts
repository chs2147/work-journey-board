// 주간 뷰 열 폭(improve-1102v7 K1): 끄는 동안은 화면 상태만, 놓을 때 일지 설정 ui.boardColW에 저장.
import { create } from "zustand";
import { BOARD_COL_W, DEFAULT_SETTINGS, validBoardColW, type BoardColW } from "../../data/settings";
import { useAppStore } from "../common/appStore";

export const useColWidths = create<BoardColW>(() => DEFAULT_SETTINGS.ui.boardColW);

/** 열 키: "label" = 업무 열, 0~6 = 월~일 자리 */
export type ColKey = "label" | number;

const clamp = (key: ColKey, v: number) => {
  const r = key === "label" ? BOARD_COL_W.label : BOARD_COL_W.day;
  return Math.round(Math.min(r.max, Math.max(r.min, v)));
};

/** 끄는 동안(저장 없음). null = 자동 */
export function setColWidth(key: ColKey, v: number | null) {
  const w = v === null ? null : clamp(key, v);
  useColWidths.setState((s) =>
    key === "label" ? { label: w } : { days: s.days.map((d, i) => (i === key ? w : d)) },
  );
}

/** 놓았을 때·두 번 누름·키보드 — 화면 + 일지 설정 */
export function commitColWidth(key: ColKey, v: number | null) {
  setColWidth(key, v);
  const j = useAppStore.getState().journal;
  if (j.state !== "ready") return;
  const { label, days } = useColWidths.getState();
  void j.repo.updateSettings({ ui: { boardColW: { label, days } } }).catch(() => undefined);
}

export function loadColWidths(ui: { boardColW: BoardColW }) {
  useColWidths.setState(validBoardColW(ui.boardColW));
}
