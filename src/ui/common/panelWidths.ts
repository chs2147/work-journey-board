// 패널 폭(improve-1101 #2): 중요 업무·주간 요약 패널 폭을 화면 상태로 들고, 놓을 때 일지 설정(ui.*PanelW)에 저장한다.
import { create } from "zustand";
import { DEFAULT_SETTINGS, PANEL_W, type PanelWidthSpec } from "../../data/settings";
import { useAppStore } from "./appStore";

export type PanelKey = keyof typeof PANEL_W;
const SETTING: Record<PanelKey, "importantPanelW" | "summaryPanelW"> = {
  important: "importantPanelW",
  summary: "summaryPanelW",
};

interface PanelWidths {
  important: number;
  summary: number;
}

export const usePanelWidths = create<PanelWidths>(() => ({
  important: DEFAULT_SETTINGS.ui.importantPanelW,
  summary: DEFAULT_SETTINGS.ui.summaryPanelW,
}));

export const clampPanel = (spec: PanelWidthSpec, v: number) =>
  Math.round(Math.min(spec.max, Math.max(spec.min, v)));

/** 끄는 동안(저장 없음) */
export function setPanelWidth(key: PanelKey, v: number) {
  usePanelWidths.setState({ [key]: clampPanel(PANEL_W[key], v) } as Partial<PanelWidths>);
}

/** 놓았을 때·두 번 누름·키보드 — 화면 + 일지 설정에 저장 */
export function commitPanelWidth(key: PanelKey, v: number) {
  setPanelWidth(key, v);
  const j = useAppStore.getState().journal;
  if (j.state !== "ready") return;
  const w = usePanelWidths.getState()[key];
  void j.repo.updateSettings({ ui: { [SETTING[key]]: w } }).catch(() => undefined);
}

/** 일지를 열 때 저장된 폭을 불러온다 */
export function loadPanelWidths(ui: { importantPanelW: number; summaryPanelW: number }) {
  usePanelWidths.setState({ important: ui.importantPanelW, summary: ui.summaryPanelW });
}
