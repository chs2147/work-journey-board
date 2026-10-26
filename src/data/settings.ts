// 앱 설정(app_meta.settings JSON, data-spec 3-4). 저장된 값이 일부 빠져 있어도 기본값과 합쳐 읽는다.
export interface Settings {
  /** 무기록 종료 제안 기준 주 수. 0 = 끔, 그 외 2~8 */
  nudgeWeeks: number;
  backup: { dailyKeep: number; monthlyKeep: number };
  summary: { includeMemo: boolean };
  ai: {
    mode: "off" | "clipboard" | "api";
    promptTemplate: string | null;
    api: { endpoint: string | null; model: string | null };
  };
  ui: {
    summaryPanelOpen: boolean;
    lastExportDir: string | null;
    /** 왼쪽 중요 업무 패널 열림(important-repeat-spec 2-5). 앱을 켤 때 0건이면 이 값과 관계없이 닫힌 채 시작 */
    importantPanelOpen: boolean;
    /**
     * 보드 아래 메모 도크(weekly-note-spec 3절·14절 F1): auto = 보드 우선 자동 높이(보드는 필요한 만큼, 메모는 남는 공간).
     * 경계선을 끌면 auto를 끄고 그 높이(px)로 고정, 도크 머리를 두 번 누르면 다시 auto.
     */
    noteDockAuto: boolean;
    noteDockHeight: number;
    noteDockCollapsed: boolean;
    /** 메모 보드 배율(improve-1026-spec 11절) — 앱 전체 하나, 0.25~2 */
    noteZoom: number;
    /** 메모 보드 미니맵 펼침 */
    noteMinimap: boolean;
    /** 마지막으로 본 뷰(spec 8절) — 다시 켜면 그 뷰로 */
    viewMode: "week" | "today";
    /** 오늘 뷰 왼쪽 메모 폭(창 폭 비율 0.2~0.7) */
    todaySplit: number;
    /** 보드 태그 필터(improve-1026-spec 6절) — 태그 id들(OR), "__none__" = 태그 없음. 빈 배열 = 전체. 다시 켜도 유지 */
    tagFilter: string[];
    /** 인사이트에서 마지막으로 본 업무(m3-s1-spec 1-2) — 레일로 열면 그 업무 */
    insightCategory: string | null;
    /** 인사이트 업무 경과 지도 펼침(4-0) */
    insightMapOpen: boolean;
    /** 인사이트에서 마지막으로 본 탭(m3-s2-spec 1절) */
    insightTab: "timeline" | "overview";
  };
}

/** 메모 보드 배율 범위(improve-1026-spec 11-1) */
export const NOTE_ZOOM_MIN = 0.25;
export const NOTE_ZOOM_MAX = 2;
/** 오늘 뷰 메모 폭 비율 범위(spec 8-2) */
export const TODAY_SPLIT_MIN = 0.2;
export const TODAY_SPLIT_MAX = 0.7;

/** 메모 도크 최소 높이(px) — 끌어서 정할 때 */
export const NOTE_DOCK_MIN = 120;
/** 자동 높이일 때 메모 도크 최소 높이(px) — 보드가 화면을 다 써도 메모가 이만큼은 보인다 */
export const NOTE_DOCK_AUTO_MIN = 160;
/** v0.2.1~0.2.2의 기본 높이 — 이 값이 저장돼 있으면 끌어서 정한 적이 없는 것으로 본다 */
const OLD_DEFAULT_DOCK_HEIGHT = 280;

export const DEFAULT_SETTINGS: Settings = {
  nudgeWeeks: 3,
  backup: { dailyKeep: 14, monthlyKeep: 12 },
  summary: { includeMemo: true },
  ai: { mode: "clipboard", promptTemplate: null, api: { endpoint: null, model: null } },
  ui: {
    summaryPanelOpen: false,
    lastExportDir: null,
    importantPanelOpen: true,
    noteDockAuto: true,
    noteDockHeight: 280,
    noteDockCollapsed: false,
    tagFilter: [],
    noteZoom: 1,
    noteMinimap: true,
    viewMode: "week",
    todaySplit: 0.42,
    insightCategory: null,
    insightMapOpen: true,
    insightTab: "timeline",
  },
};

export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K];
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in base)) continue; // 모르는 키는 버린다
    out[k] = isObject((base as Record<string, unknown>)[k])
      ? deepMerge((base as Record<string, unknown>)[k], v)
      : v;
  }
  return out as T;
}

export function validNudgeWeeks(n: number): boolean {
  return Number.isInteger(n) && (n === 0 || (n >= 2 && n <= 8));
}

/** 기본값 위에 저장값(또는 변경분)을 합치고, 범위를 벗어난 값은 기본값으로 되돌린다. */
export function mergeSettings(base: Settings, patch: unknown): Settings {
  const s = deepMerge(base, patch);
  // v0.2.2 이전 저장값(auto 없음): 기본 높이와 다르면 사용자가 끌어서 정한 높이 → 고정으로 둔다
  if (
    isObject(patch) &&
    isObject(patch.ui) &&
    !("noteDockAuto" in patch.ui) &&
    typeof patch.ui.noteDockHeight === "number" &&
    patch.ui.noteDockHeight !== OLD_DEFAULT_DOCK_HEIGHT
  )
    s.ui.noteDockAuto = false;
  if (!validNudgeWeeks(s.nudgeWeeks)) s.nudgeWeeks = DEFAULT_SETTINGS.nudgeWeeks;
  if (!(s.backup.dailyKeep >= 1)) s.backup.dailyKeep = DEFAULT_SETTINGS.backup.dailyKeep;
  if (!(s.backup.monthlyKeep >= 0)) s.backup.monthlyKeep = DEFAULT_SETTINGS.backup.monthlyKeep;
  if (s.ai.mode === "api") s.ai.mode = "clipboard"; // v1에서는 API 모드 선택 불가(자리만)
  if (!(s.ui.noteZoom >= NOTE_ZOOM_MIN && s.ui.noteZoom <= NOTE_ZOOM_MAX)) s.ui.noteZoom = 1;
  if (typeof s.ui.noteMinimap !== "boolean") s.ui.noteMinimap = true;
  if (s.ui.viewMode !== "week" && s.ui.viewMode !== "today") s.ui.viewMode = "week";
  if (!(s.ui.todaySplit >= TODAY_SPLIT_MIN && s.ui.todaySplit <= TODAY_SPLIT_MAX))
    s.ui.todaySplit = DEFAULT_SETTINGS.ui.todaySplit;
  if (!Array.isArray(s.ui.tagFilter) || !s.ui.tagFilter.every((x) => typeof x === "string"))
    s.ui.tagFilter = [];
  if (s.ui.insightCategory !== null && typeof s.ui.insightCategory !== "string") s.ui.insightCategory = null;
  if (typeof s.ui.insightMapOpen !== "boolean") s.ui.insightMapOpen = true;
  if (s.ui.insightTab !== "timeline" && s.ui.insightTab !== "overview") s.ui.insightTab = "timeline";
  if (!(s.ui.noteDockHeight >= NOTE_DOCK_MIN)) s.ui.noteDockHeight = DEFAULT_SETTINGS.ui.noteDockHeight;
  return s;
}
