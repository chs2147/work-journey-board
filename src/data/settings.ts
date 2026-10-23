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
  ui: { summaryPanelOpen: boolean; lastExportDir: string | null };
}

export const DEFAULT_SETTINGS: Settings = {
  nudgeWeeks: 3,
  backup: { dailyKeep: 14, monthlyKeep: 12 },
  summary: { includeMemo: true },
  ai: { mode: "clipboard", promptTemplate: null, api: { endpoint: null, model: null } },
  ui: { summaryPanelOpen: false, lastExportDir: null },
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
  if (!validNudgeWeeks(s.nudgeWeeks)) s.nudgeWeeks = DEFAULT_SETTINGS.nudgeWeeks;
  if (!(s.backup.dailyKeep >= 1)) s.backup.dailyKeep = DEFAULT_SETTINGS.backup.dailyKeep;
  if (!(s.backup.monthlyKeep >= 0)) s.backup.monthlyKeep = DEFAULT_SETTINGS.backup.monthlyKeep;
  if (s.ai.mode === "api") s.ai.mode = "clipboard"; // v1에서는 API 모드 선택 불가(자리만)
  return s;
}
