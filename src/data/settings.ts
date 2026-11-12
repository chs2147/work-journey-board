// 앱 설정(app_meta.settings JSON, data-spec 3-4). 저장된 값이 일부 빠져 있어도 기본값과 합쳐 읽는다.
import { normalizeBackupPolicy, RECOMMENDED_BACKUP_POLICY, type BackupPolicy } from "./backupPolicy";
import { COMPANY_DATE_RE, LABEL_MAX_HOLIDAY, type HolidaySettings } from "../domain/holidaysKr";
import { parseMeta, type WorkspaceMeta } from "../domain/workspace";
import {
  DEFAULT_KANBAN_FILTER,
  DEFAULT_KANBAN_LAYOUT,
  KANBAN_FREE,
  KANBAN_PERIODS,
  type KanbanFilter,
  type KanbanLayout,
} from "../domain/kanban";
export interface Settings {
  /** 이 일지(워크스페이스)의 이름·색·아이콘(multi-board-spec 7절) — 없으면 이 PC 목록의 사본으로 채운다 */
  workspace: WorkspaceMeta | null;
  /** 무기록 종료 제안 기준 주 수. 0 = 끔, 그 외 2~8 */
  nudgeWeeks: number;
  /** periodicHours = 켜 둔 동안 바뀐 게 있으면 이 시간마다 그날 일일 사본을 덮어씀(optimize-1031-plan B1, 0 = 끔) */
  backup: BackupPolicy;
  summary: { includeMemo: boolean };
  /** 달력·휴일(features-1102-spec F2·F3): 대한민국 공휴일 자동 표시·끈 날짜·회사 휴일·기타 휴가 사유 */
  holiday: HolidaySettings;
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
    /** 데일리 뷰 [기록 있는 업무만](1.24.1) — 그 날 항목 0건인 업무 카드를 숨김. 다시 켜도 유지 */
    todayHideEmpty: boolean;
    /** 왼쪽 중요 업무·오른쪽 주간 요약 패널 폭(px, improve-1101 #2) — 가장자리를 끌어 조절, 두 번 누르면 기본 */
    importantPanelW: number;
    summaryPanelW: number;
    /** 주간 뷰 열 폭(improve-1102v7 K1) — label = 업무 열, days = 월~일 자리(null = 자동) */
    boardColW: BoardColW;
    /** 보드 태그 필터(improve-1026-spec 6절) — 태그 id들(OR), "__none__" = 태그 없음. 빈 배열 = 전체. 다시 켜도 유지 */
    tagFilter: string[];
    /** 인사이트에서 마지막으로 본 업무(m3-s1-spec 1-2) — 레일로 열면 그 업무 */
    insightCategory: string | null;
    insightListWidth: number;
    activityNameWidth: number;
    /** 인사이트 업무 경과 지도 펼침(4-0) */
    insightMapOpen: boolean;
    /** 인사이트에서 마지막으로 본 탭(m3-s2-spec 1절) */
    insightTab: "timeline" | "overview";
    /** 엑셀 내보내기 [포함] "메모 보드 스냅샷" 마지막 선택(improve-1027v3-spec 1-5, 기본 꺼짐) */
    exportSnapshots: boolean;
    /** 중요 업무 패널 아래 "이 주 완료" 펼침(improve-1027v4-spec 4절) */
    weekDoneOpen: boolean;
    /** 설정 화면에서 마지막으로 본 분류(improve-1027v5-spec 1-2) */
    settingsCategory: SettingsCategory;
    /** 앱을 켰을 때 먼저 보일 화면(improve-v21-spec 8절) — board = 마지막 주간/데일리 뷰 */
    startView: "board" | "kanban";
    /** 칸반 보드 필터·정렬(improve-v21-spec 2-5) */
    kanban: KanbanFilter;
    /** 칸반 배치 모드(improve-v22-spec 4절) — 공간마다 */
    kanbanLayout: KanbanLayout;
  };
}

export interface BoardColW {
  label: number | null;
  days: (number | null)[];
}
/** 주간 뷰 열 폭 범위(improve-1102v7 K1) */
export const BOARD_COL_W = {
  label: { def: 184, min: 120, max: 400 },
  day: { min: 80, max: 900 },
} as const;

/** 설정 화면 분류(improve-1027v5-spec 1-4) */
export const SETTINGS_CATEGORIES = [
  "workspace",
  "screen",
  "data",
  "import",
  "work",
  "calendar",
  "update",
] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

/** 메모 보드 배율 범위(improve-1026-spec 11-1) */
export const NOTE_ZOOM_MIN = 0.25;
export const NOTE_ZOOM_MAX = 2;
/** 오늘 뷰 메모 폭 비율 범위(spec 8-2) */
export const TODAY_SPLIT_MIN = 0.2;
export const TODAY_SPLIT_MAX = 0.7;
/** 패널 폭 범위(improve-1101 #2, 2026-11-01 추천안 확정) */
export const PANEL_W = {
  important: { def: 264, min: 220, max: 520 },
  summary: { def: 360, min: 300, max: 720 },
} as const;
export type PanelWidthSpec = { def: number; min: number; max: number };

/** 메모 도크 최소 높이(px) — 끌어서 정할 때 */
export const NOTE_DOCK_MIN = 120;
/** 자동 높이일 때 메모 도크 최소 높이(px) — 보드가 화면을 다 써도 메모가 이만큼은 보인다 */
export const NOTE_DOCK_AUTO_MIN = 160;
/** v0.2.1~0.2.2의 기본 높이 — 이 값이 저장돼 있으면 끌어서 정한 적이 없는 것으로 본다 */
const OLD_DEFAULT_DOCK_HEIGHT = 280;

export const DEFAULT_SETTINGS: Settings = {
  workspace: null,
  nudgeWeeks: 3,
  backup: { ...RECOMMENDED_BACKUP_POLICY },
  summary: { includeMemo: true },
  holiday: {
    krEnabled: true,
    off: [],
    company: [],
    reasons: ["공가", "야유회", "경조사", "교육", "대체휴무"],
  },
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
    todayHideEmpty: false,
    importantPanelW: 264,
    summaryPanelW: 360,
    boardColW: { label: null, days: [null, null, null, null, null, null, null] },
    insightCategory: null,
    insightListWidth: 272,
    activityNameWidth: 196,
    insightMapOpen: true,
    insightTab: "timeline",
    exportSnapshots: false,
    weekDoneOpen: true,
    settingsCategory: "screen",
    startView: "board",
    kanban: DEFAULT_KANBAN_FILTER,
    kanbanLayout: DEFAULT_KANBAN_LAYOUT,
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
  // 칸반 배치 자리(improve-v22-spec 4절)는 키가 섹션 id라 기본값에 없다 — 깊이 합치지 않고 통째로 바꾼다(지운 섹션 자리도 빠짐)
  if (isObject(patch) && isObject(patch.ui) && "kanbanLayout" in patch.ui)
    s.ui.kanbanLayout = validKanbanLayout(patch.ui.kanbanLayout);
  // v0.2.2 이전 저장값(auto 없음): 기본 높이와 다르면 사용자가 끌어서 정한 높이 → 고정으로 둔다
  if (
    isObject(patch) &&
    isObject(patch.ui) &&
    !("noteDockAuto" in patch.ui) &&
    typeof patch.ui.noteDockHeight === "number" &&
    patch.ui.noteDockHeight !== OLD_DEFAULT_DOCK_HEIGHT
  )
    s.ui.noteDockAuto = false;
  s.workspace = parseMeta(s.workspace);
  s.backup = normalizeBackupPolicy(s.backup, false);

  if (!validNudgeWeeks(s.nudgeWeeks)) s.nudgeWeeks = DEFAULT_SETTINGS.nudgeWeeks;
  if (!(s.backup.dailyKeep >= 1)) s.backup.dailyKeep = DEFAULT_SETTINGS.backup.dailyKeep;
  if (!(s.backup.monthlyKeep >= 0)) s.backup.monthlyKeep = DEFAULT_SETTINGS.backup.monthlyKeep;
  if (!(s.backup.periodicHours >= 0 && s.backup.periodicHours <= 24))
    s.backup.periodicHours = DEFAULT_SETTINGS.backup.periodicHours;
  const h = s.holiday;
  if (typeof h.krEnabled !== "boolean") h.krEnabled = true;
  const strs = (v: unknown, max: number) =>
    Array.isArray(v)
      ? [
          ...new Set(
            v
              .filter((x): x is string => typeof x === "string")
              .map((x) => x.trim())
              .filter(Boolean),
          ),
        ].map((x) => x.slice(0, max))
      : [];
  h.off = strs(h.off, 10).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  h.reasons = strs(h.reasons, LABEL_MAX_HOLIDAY);
  h.company = (Array.isArray(h.company) ? h.company : [])
    .filter(
      (c): c is { date: string; name: string } =>
        !!c && typeof c.date === "string" && COMPANY_DATE_RE.test(c.date) && typeof c.name === "string",
    )
    .map((c) => ({ date: c.date, name: c.name.trim().slice(0, LABEL_MAX_HOLIDAY) }));
  if (s.ai.mode === "api") s.ai.mode = "clipboard"; // v1에서는 API 모드 선택 불가(자리만)
  if (!(s.ui.noteZoom >= NOTE_ZOOM_MIN && s.ui.noteZoom <= NOTE_ZOOM_MAX)) s.ui.noteZoom = 1;
  if (typeof s.ui.noteMinimap !== "boolean") s.ui.noteMinimap = true;
  if (s.ui.viewMode !== "week" && s.ui.viewMode !== "today") s.ui.viewMode = "week";
  if (!(s.ui.todaySplit >= TODAY_SPLIT_MIN && s.ui.todaySplit <= TODAY_SPLIT_MAX))
    s.ui.todaySplit = DEFAULT_SETTINGS.ui.todaySplit;
  if (typeof s.ui.todayHideEmpty !== "boolean") s.ui.todayHideEmpty = false;
  for (const [k, spec] of [
    ["importantPanelW", PANEL_W.important],
    ["summaryPanelW", PANEL_W.summary],
    ["insightListWidth", { min: 200, max: 480, def: 272 }],
    ["activityNameWidth", { min: 160, max: 420, def: 196 }],
  ] as const) {
    const v = s.ui[k];
    if (!(typeof v === "number" && v >= spec.min && v <= spec.max)) s.ui[k] = spec.def;
  }
  s.ui.boardColW = validBoardColW(s.ui.boardColW);
  if (!Array.isArray(s.ui.tagFilter) || !s.ui.tagFilter.every((x) => typeof x === "string"))
    s.ui.tagFilter = [];
  if (s.ui.insightCategory !== null && typeof s.ui.insightCategory !== "string") s.ui.insightCategory = null;
  if (typeof s.ui.insightMapOpen !== "boolean") s.ui.insightMapOpen = true;
  if (s.ui.insightTab !== "timeline" && s.ui.insightTab !== "overview") s.ui.insightTab = "timeline";
  if (typeof s.ui.exportSnapshots !== "boolean") s.ui.exportSnapshots = false;
  if (typeof s.ui.weekDoneOpen !== "boolean") s.ui.weekDoneOpen = true;
  if (!(SETTINGS_CATEGORIES as readonly string[]).includes(s.ui.settingsCategory))
    s.ui.settingsCategory = "screen";
  if (!(s.ui.noteDockHeight >= NOTE_DOCK_MIN)) s.ui.noteDockHeight = DEFAULT_SETTINGS.ui.noteDockHeight;
  if (s.ui.startView !== "board" && s.ui.startView !== "kanban") s.ui.startView = "board";
  s.ui.kanban = validKanbanFilter(s.ui.kanban);
  s.ui.kanbanLayout = validKanbanLayout(s.ui.kanbanLayout);
  return s;
}

/** 열 폭 설정 검사 — 범위 밖·모르는 값은 자동(null) */
export function validBoardColW(v: unknown): BoardColW {
  const o = (v && typeof v === "object" ? v : {}) as { label?: unknown; days?: unknown };
  const num = (x: unknown, min: number, max: number) =>
    typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? Math.round(x) : null;
  const days = Array.isArray(o.days) ? o.days : [];
  return {
    label: num(o.label, BOARD_COL_W.label.min, BOARD_COL_W.label.max),
    days: Array.from({ length: 7 }, (_, i) => num(days[i], BOARD_COL_W.day.min, BOARD_COL_W.day.max)),
  };
}

/** 칸반 필터 검사 — 모르는 값은 기본 */
export function validKanbanFilter(v: unknown): KanbanFilter {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof KanbanFilter, unknown>>;
  const date = (x: unknown) => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  return {
    categories: Array.isArray(o.categories)
      ? o.categories.filter((x): x is string => typeof x === "string")
      : [],
    includeEnded: o.includeEnded === true,
    period: (KANBAN_PERIODS as readonly unknown[]).includes(o.period)
      ? (o.period as KanbanFilter["period"])
      : DEFAULT_KANBAN_FILTER.period,
    from: date(o.from),
    to: date(o.to),
    sort: o.sort === "old" || o.sort === "due" ? o.sort : "new",
  };
}

/** 칸반 배치 검사 — 모르는 모드는 균등, 이상한 자리는 버림(기본 자리로 다시 놓임) */
export function validKanbanLayout(v: unknown): KanbanLayout {
  const o = (v && typeof v === "object" ? v : {}) as { mode?: unknown; rects?: unknown };
  const rects: KanbanLayout["rects"] = {};
  if (o.rects && typeof o.rects === "object" && !Array.isArray(o.rects)) {
    for (const [k, r] of Object.entries(o.rects as Record<string, unknown>)) {
      const q = (r ?? {}) as Record<string, unknown>;
      const ok = (x: unknown, min: number) =>
        typeof x === "number" && Number.isFinite(x) && x >= min && x <= KANBAN_FREE.maxXY;
      if (ok(q.x, 0) && ok(q.y, 0) && ok(q.w, KANBAN_FREE.minW) && ok(q.h, KANBAN_FREE.minH))
        rects[k] = { x: q.x as number, y: q.y as number, w: q.w as number, h: q.h as number };
    }
  }
  return { mode: o.mode === "free" ? "free" : "equal", rects };
}
