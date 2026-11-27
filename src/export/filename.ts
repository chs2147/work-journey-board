// 내보내기 파일명·문서 제목(output-spec 4-2·3-3). 같은 이름이 있으면 윈도우 저장 대화상자의 덮어쓰기 확인을 따른다.
import { compareWeekId, parseWeekId, weeksInIsoYear, type WeekId } from "../domain/week";

/** 범위 표기: 한 주 `2026-W43`, 같은 연도 `2026-W40~W43`, 연도를 넘김 `2025-W50~2026-W03` */
export function rangeLabel(from: WeekId, to: WeekId): string {
  if (from === to) return from;
  const a = parseWeekId(from);
  const b = parseWeekId(to);
  return a.year === b.year ? `${from}~W${String(b.week).padStart(2, "0")}` : `${from}~${to}`;
}

export interface ExportNameOptions {
  /** 확장자(기본 xlsx) */
  ext?: "xlsx" | "md";
  /** 연도 범위(improve-v27 1-3) — 그 해 전체면 `2026년`, 일부면 `2026년_W38~W43` */
  year?: number;
  /** 고른 업무 표시(1개 = 이름, 여러 개 = `업무N개`) — 전체면 없음 */
  categories?: string;
}

/** `업무일지_2026-W43.xlsx` · `업무일지_2026-W40~W43.xlsx` · `업무일지_2025-W50~2026-W03.xlsx` · `업무일지_전체_2026-W38~W43.xlsx`
 *  · `업무일지_2026년.md` · `업무일지_협력사 보안 점검_2026년_W38~W43.xlsx` */
export function exportFileName(
  from: WeekId,
  to: WeekId,
  all = false,
  workspace?: string,
  opt: ExportNameOptions = {},
): string {
  const cats = workspacePart(opt.categories);
  const range =
    opt.year !== undefined ? yearLabel(opt.year, from, to) : `${all ? "전체_" : ""}${rangeLabel(from, to)}`;
  return `업무일지_${workspacePart(workspace)}${cats}${range}.${opt.ext ?? "xlsx"}`;
}

/** 연도 범위 표기: 그 해 W01~마지막 주 전체면 `2026년`, 아니면 `2026년_W38~W43` */
export function yearLabel(year: number, from: WeekId, to: WeekId): string {
  const a = parseWeekId(from);
  const b = parseWeekId(to);
  const w = (n: number) => `W${String(n).padStart(2, "0")}`;
  if (a.year === year && b.year === year && a.week === 1 && b.week === weeksInIsoYear(year))
    return `${year}년`;
  return a.week === b.week && a.year === b.year
    ? `${year}년_${w(a.week)}`
    : `${year}년_${w(a.week)}~${w(b.week)}`;
}

/** 워크스페이스가 2개 이상일 때 파일 이름에 넣는 공간 이름(multi-board-spec D8) — 파일 이름에 못 쓰는 글자는 뺀다 */
export function workspacePart(name?: string): string {
  const clean = (name ?? "").replace(/[\\/:*?"<>|]/g, "").trim();
  return clean ? `${clean}_` : "";
}

/** 문서 속성 제목: `업무일지 2026-W42~W43` */
export function exportTitle(from: WeekId, to: WeekId): string {
  return `업무일지 ${rangeLabel(from, to)}`;
}

/**
 * 연도 범위(improve-v27 D3): 그 해 W01~마지막 주를 첫 기록 주·이번(최신) 주로 잘라낸다 — 빈 주가 수십 개 생기지 않게.
 * 잘라낸 결과가 비면(그 해에 기록이 없고 지난해) 그 해 전체.
 */
export function yearRange(
  year: number,
  current: WeekId,
  firstRecord: WeekId | null,
  latest = current,
): [WeekId, WeekId] {
  const pad = (n: number) => String(n).padStart(2, "0");
  let a: WeekId = `${year}-W01`;
  let b: WeekId = `${year}-W${pad(weeksInIsoYear(year))}`;
  const end = compareWeekId(latest, current) > 0 ? latest : current;
  if (compareWeekId(b, end) > 0) b = end;
  if (firstRecord && compareWeekId(firstRecord, a) > 0 && compareWeekId(firstRecord, b) <= 0) a = firstRecord;
  return compareWeekId(a, b) <= 0 ? [a, b] : [`${year}-W01`, `${year}-W${pad(weeksInIsoYear(year))}`];
}
