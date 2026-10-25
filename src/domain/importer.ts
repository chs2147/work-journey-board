// 기존 일지 가져오기(i-m3-plan 3절): 표(엑셀 시트·CSV·붙여넣은 글) → 항목 행 → 주별 처리 계획. 순수 함수만.
// 원천: ① 앱의 가져오기 양식(사내 AI가 OneNote 캡처를 옮겨 적음) ② 앱이 내보낸 엑셀 원장 시트 ③ 그 밖의 표(열 맞추기).
import { normalizeCategoryName } from "./categories";
import type { CategoryPeriod } from "./types";
import { addDays, DAY_LABELS, weekIdOf, weekStart, type DateStr, type WeekId } from "./week";

export type Cell = string | number | Date | null;

export type ImportRole = "weekStart" | "date" | "day" | "category" | "depth" | "text";
export type ColumnMapping = Record<ImportRole, number | null>;
export type SourceKind = "template" | "ledger" | "generic";

/** 양식의 머리줄(이 순서·이름으로 만든다 — 3-3절) */
export const TEMPLATE_HEADERS = ["주 시작일", "날짜", "요일", "업무", "세부", "내용"] as const;
/** 업무 대신 그 주 주간 메모로 보내는 예약 이름 */
export const MEMO_CATEGORY = "메모";
export const IMPORT_TEXT_MAX = 2000;

const ALIASES: Record<ImportRole, string[]> = {
  weekStart: ["주시작일", "주시작", "주간시작일", "주의월요일", "weekstart"],
  date: ["날짜", "일자", "기록일", "date"],
  day: ["요일", "day", "weekday"],
  category: ["업무", "업무명", "프로젝트", "분류", "카테고리", "category", "task", "project"],
  depth: ["세부", "세부여부", "레벨", "깊이", "depth", "level"],
  text: ["내용", "업무내용", "한일", "진행내용", "내역", "content", "text", "description"],
};
const headerKey = (v: Cell) =>
  String(v ?? "")
    .normalize("NFKC")
    .replace(/[\s_()[\]·.:-]/g, "")
    .toLowerCase();

export interface DetectedTable {
  kind: SourceKind;
  headerRow: number;
  mapping: ColumnMapping;
}

/** 머리줄 찾기(첫 10행) + 원천 종류. 날짜(또는 주 시작일+요일)·업무·내용 열이 없으면 null(열 맞추기 필요) */
export function detectTable(rows: Cell[][]): DetectedTable | null {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const keys = (rows[r] ?? []).map(headerKey);
    const find = (role: ImportRole) => {
      const i = keys.findIndex((k) => ALIASES[role].includes(k));
      return i >= 0 ? i : null;
    };
    const mapping: ColumnMapping = {
      weekStart: find("weekStart"),
      date: find("date"),
      day: find("day"),
      category: find("category"),
      depth: find("depth"),
      text: find("text"),
    };
    const hasWhen = mapping.date !== null || (mapping.weekStart !== null && mapping.day !== null);
    if (!hasWhen || mapping.category === null || mapping.text === null) continue;
    const kind: SourceKind =
      mapping.weekStart !== null && mapping.day !== null
        ? "template"
        : keys.includes("주차") && keys.includes("순번")
          ? "ledger"
          : "generic";
    return { kind, headerRow: r, mapping };
  }
  return null;
}

/** 열 맞추기 화면용: 머리줄(없으면 열 문자)과 앞 값 몇 개 */
export function columnLabels(rows: Cell[][], headerRow: number): string[] {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return Array.from({ length: width }, (_, i) => {
    const h = String(rows[headerRow]?.[i] ?? "").trim();
    return h || colLetter(i);
  });
}
export const colLetter = (i: number): string =>
  (i >= 26 ? colLetter(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));

// ── 칸 값 해석 ─────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
function ymd(y: number, m: number, d: number): DateStr | null {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1990 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** 날짜 칸: 엑셀 날짜 값(Date·일련번호), `2025-03-04`·`2025.03.04`·`2025/3/4`·`25.03.04`·`2025년 3월 4일`. 못 읽으면 null */
export function parseDateCell(v: Cell): DateStr | null {
  if (v === null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // 엑셀 날짜는 UTC 자정으로 들어온다(ExcelJS)
    return ymd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null; // 엑셀 일련번호(1954~2119)만
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = v.normalize("NFKC").trim();
  const m =
    /^(\d{2}|\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?(?:\s*\(?[월화수목금토일]\)?)?(?:\s.*)?$/.exec(
      s,
    );
  return m ? ymd(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** 요일 칸 → 0(월)~6(일). `월`·`월요일`·`(월)`·`Mon` */
export function parseDayCell(v: Cell): number | null {
  const s = String(v ?? "")
    .normalize("NFKC")
    .replace(/[()\s]/g, "")
    .toLowerCase();
  if (!s) return null;
  const ko = DAY_LABELS.findIndex((d) => s === d || s === `${d}요일`);
  if (ko >= 0) return ko;
  const en = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].findIndex((d) => s.startsWith(d));
  return en >= 0 ? en : null;
}

/** 세부 칸: 값이 있으면 세부(단 `0`·`본`·`N`·`아니오`·`false`는 본 항목) */
export function parseDepthCell(v: Cell): 0 | 1 {
  const s = String(v ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  return !s || ["0", "본", "n", "no", "아니오", "false", "x"].includes(s) ? 0 : 1;
}

const BULLET_RE = /^\s*(?:[-•·○◦▪▫■□*‣–—]|\d{1,2}[.)])\s+/;
/** 내용 칸: 앞머리 글머리 기호를 떼고, 줄 끝 공백 정리. 칸 안 줄바꿈은 그 항목 안 줄바꿈으로 둔다 */
export function cleanText(v: Cell): string {
  return String(v instanceof Date ? "" : (v ?? ""))
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .trim()
    .replace(BULLET_RE, "");
}

/** 업무 이름 비교 열쇠(공백·전각/반각·대소문자 무시) */
export const categoryKey = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
/** 메모 행의 종류: day = 그날의 일(`- (요일) 내용`), week = 원장의 `(주간 메모)`(주 전체 글 — 요일 없음) */
function memoKind(name: string): "day" | "week" | null {
  const k = categoryKey(name).replace(/\s/g, "");
  if (k === "메모" || k === "(메모)") return "day";
  if (k === "주간메모" || k === "(주간메모)") return "week";
  return null;
}

// ── 행 해석 ───────────────────────────────────────────
export interface ImportRow {
  /** 원본 행 번호(엑셀 행 번호, 1부터) */
  line: number;
  date: DateStr;
  /** 업무 이름(표시용 정리). 메모 행이면 MEMO_CATEGORY */
  category: string;
  /** 업무가 아니라 그 주 주간 메모로 가는 행 */
  memo: "day" | "week" | null;
  depth: 0 | 1;
  text: string;
}

export type IssueReason =
  | "no-date"
  | "no-category"
  | "long-category"
  | "no-text"
  | "long-text"
  | "future"
  | "week-start-fixed"
  | "day-mismatch"
  | "outside-week";

export interface ImportIssue {
  line: number;
  reason: IssueReason;
  /** 문제 행 내용 요약(미리보기 목록) */
  sample: string;
}

export interface ParsedImport {
  kind: SourceKind;
  rows: ImportRow[];
  /** 가져오지 않는 행 */
  skipped: ImportIssue[];
  /** 가져오되 확인이 필요한 행 */
  warnings: ImportIssue[];
  /** 오늘 이후 날짜 행(includeFuture면 rows에도 들어 있음) */
  future: number;
}

export interface ParseOptions {
  today: DateStr;
  /** 미래 날짜 행도 가져오기(기본: 건너뜀) */
  includeFuture?: boolean;
}

/** 표 → 항목 행(3-6절 해석 규칙) */
export function parseRows(
  rows: Cell[][],
  headerRow: number,
  mapping: ColumnMapping,
  kind: SourceKind,
  opt: ParseOptions,
): ParsedImport {
  const out: ParsedImport = { kind, rows: [], skipped: [], warnings: [], future: 0 };
  const at = (r: Cell[], role: ImportRole): Cell =>
    mapping[role] === null ? null : (r[mapping[role]!] ?? null);
  let prev: { weekStart: DateStr | null; day: number | null; date: DateStr; category: string | null } | null =
    null;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every((c) => c === null || String(c).trim() === "")) continue;
    const line = i + 1;
    const text = cleanText(at(r, "text"));
    const sample = [at(r, "date") ?? at(r, "day"), at(r, "category"), text.slice(0, 40)]
      .map((c) => (c instanceof Date ? (parseDateCell(c) ?? "") : String(c ?? "").trim()))
      .filter(Boolean)
      .join(" · ");
    const issue = (reason: IssueReason) => ({ line, reason, sample });

    // 날짜: ① 날짜 칸 ② 주 시작일 + 요일 ③ 같은 주·요일의 바로 위 행
    let ws = parseDateCell(at(r, "weekStart"));
    const day = parseDayCell(at(r, "day"));
    if (ws) {
      const monday = weekStart(weekIdOf(ws));
      if (monday !== ws) {
        out.warnings.push(issue("week-start-fixed"));
        ws = monday;
      }
    }
    let date = parseDateCell(at(r, "date"));
    if (date) {
      if (day !== null && day !== dayOf(date)) out.warnings.push(issue("day-mismatch"));
      if (ws && weekStart(weekIdOf(date)) !== ws) out.warnings.push(issue("outside-week"));
    } else if (ws && day !== null) {
      date = addDays(ws, day);
    } else if (kind !== "template" && prev && ws === null && day === null) {
      // 날짜를 묶음 첫 행에만 적은 일반 표 — 위 행 날짜를 이어 씀.
      // 가져오기 양식(사내 AI 작성)은 행마다 요일·날짜를 적으므로, 둘 다 없는 행은 요약 칸 등으로 보고 건너뛴다(3-1절)
      date = prev.date;
    }
    if (!date) {
      out.skipped.push(issue("no-date"));
      continue;
    }

    // 업무: 비어 있으면 같은 날짜의 바로 위 행 업무
    const rawCat = String(at(r, "category") ?? "").trim();
    const catName: string | null = rawCat || (prev && prev.date === date ? prev.category : null);
    if (!catName) {
      out.skipped.push(issue("no-category"));
      continue;
    }
    const memo = memoKind(catName);
    const category = memo ? MEMO_CATEGORY : normalizeCategoryName(catName);
    if (!category) {
      out.skipped.push(issue("long-category"));
      continue;
    }
    prev = { weekStart: ws ?? weekStart(weekIdOf(date)), day: dayOf(date), date, category: catName };

    if (!text || /^(\[\?\]\s*)+$/.test(text)) {
      out.skipped.push(issue("no-text"));
      continue;
    }
    if (text.length > IMPORT_TEXT_MAX) {
      out.skipped.push(issue("long-text"));
      continue;
    }
    if (date > opt.today) {
      out.future++;
      if (!opt.includeFuture) {
        out.skipped.push(issue("future"));
        continue;
      }
    }
    // 원장 시트의 `세부`는 순번(숫자) — 값이 있으면 세부
    const depth = mapping.depth === null ? 0 : parseDepthCell(at(r, "depth"));
    out.rows.push({ line, date, category, memo, depth, text });
  }
  return out;
}

const dayOf = (date: DateStr) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

/** 구분자 글(탭·쉼표) → 표. 따옴표로 감싼 칸(쉼표·줄바꿈 포함)을 지원. 탭이 하나라도 있으면 탭 구분 */
export function parseDelimited(text: string): Cell[][] {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const firstLine = src.slice(0, src.indexOf("\n") >= 0 ? src.indexOf("\n") : undefined);
  const sep = firstLine.includes("\t") ? "\t" : ",";
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => (c === "" ? null : c)));
}

// ── 주별 처리 계획(3-5·3-7절) ─────────────────────────
export type WeekAction = "import" | "merge" | "overwrite" | "skip";

export interface ExistingItem {
  id: string;
  date: DateStr;
  categoryId: string;
  seq: number;
  depth: 0 | 1;
  text: string;
}

export interface ImportContext {
  today: DateStr;
  categories: { id: string; name: string; sortOrder: number }[];
  periods: CategoryPeriod[];
  /** 파일에 나온 주들의 이 앱 기록 */
  items: ExistingItem[];
  /** 그 주들의 주간 메모: 글·이미지가 있는가, 상자 수 */
  notes: Record<WeekId, { boxes: number; empty: boolean }>;
}

export interface ImportChoices {
  /** 기록이 있는 주의 처리(없으면 merge) */
  weekActions?: Record<WeekId, Exclude<WeekAction, "import">>;
  /** 종료된 업무 중 다시 시작할 것(3-7절, 3-8 F) */
  reopen?: string[];
}

export type CategoryRef = { id: string } | { newKey: string };

export interface PlannedInsert {
  line: number;
  date: DateStr;
  cat: CategoryRef;
  seq: number;
  depth: 0 | 1;
  text: string;
}

export interface WeekPlan {
  weekId: WeekId;
  action: WeekAction;
  /** 파일의 그 주 항목·메모 줄 수 */
  fileItems: number;
  fileMemo: number;
  /** 이 앱의 그 주 항목 수·메모 상자 수 */
  existingItems: number;
  existingMemoBoxes: number;
  /** 실제로 더할 항목 수 · 병합에서 같은 기록이라 건너뛸 수 · 덮어쓰기로 지울 항목 수 */
  add: number;
  duplicates: number;
  remove: number;
  /** 업무별 비교(펼친 행): 업무 이름 → [파일, 이 앱] */
  byCategory: { name: string; file: number; existing: number }[];
}

export interface ImportPlan {
  weeks: WeekPlan[];
  newCategories: { key: string; name: string; startDate: DateStr; sortOrder: number }[];
  matched: { id: string; name: string; ended: boolean }[];
  inserts: PlannedInsert[];
  deleteItemIds: string[];
  /** 주간 메모: add = 상자 하나 더함, replace = 그 상자 하나(줄이 없으면 빈 메모)로 바꿈 */
  memos: {
    weekId: WeekId;
    mode: "add" | "replace";
    lines: { date: DateStr; text: string; day: boolean }[];
  }[];
  /** 활성 구간 시작 앞당기기 */
  periodMoves: { periodId: string; from: DateStr; to: DateStr }[];
  reopen: string[];
  totals: { weeks: number; items: number; memoLines: number; duplicates: number; removed: number };
}

const itemKey = (date: DateStr, catId: string, depth: number, text: string) =>
  `${date}|${catId}|${depth}|${text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase()}`;

/** 해석한 행 + 이 앱 상태 + 사용자 선택 → 쓰기 계획. 기록 있는 주의 기본 처리는 병합(3-8 A) */
export function planImport(rows: ImportRow[], ctx: ImportContext, choices: ImportChoices = {}): ImportPlan {
  const catByKey = new Map(ctx.categories.map((c) => [categoryKey(c.name), c]));
  const openCats = new Set(ctx.periods.filter((p) => p.endDate === null).map((p) => p.categoryId));
  const plan: ImportPlan = {
    weeks: [],
    newCategories: [],
    matched: [],
    inserts: [],
    deleteItemIds: [],
    memos: [],
    periodMoves: [],
    reopen: [],
    totals: { weeks: 0, items: 0, memoLines: 0, duplicates: 0, removed: 0 },
  };

  // 주별로 묶기
  const byWeek = new Map<WeekId, ImportRow[]>();
  for (const r of rows) {
    const w = weekIdOf(r.date);
    byWeek.set(w, [...(byWeek.get(w) ?? []), r]);
  }
  const existingByWeek = new Map<WeekId, ExistingItem[]>();
  for (const it of ctx.items) {
    const w = weekIdOf(it.date);
    existingByWeek.set(w, [...(existingByWeek.get(w) ?? []), it]);
  }

  // 업무 매칭(파일에 처음 나온 순서대로 새 업무)
  const newByKey = new Map<string, ImportPlan["newCategories"][number]>();
  const matchedIds = new Set<string>();
  const firstDate = new Map<string, DateStr>(); // 업무 열쇠 → 실제로 가져올 첫 날짜
  let order = ctx.categories.reduce((m, c) => Math.max(m, c.sortOrder), 0);
  const refOf = (name: string): CategoryRef => {
    const key = categoryKey(name);
    const hit = catByKey.get(key);
    if (hit) {
      matchedIds.add(hit.id);
      return { id: hit.id };
    }
    if (!newByKey.has(key)) newByKey.set(key, { key, name, startDate: "", sortOrder: ++order });
    return { newKey: key };
  };
  const refKey = (ref: CategoryRef) => ("id" in ref ? `id:${ref.id}` : `new:${ref.newKey}`);

  const weekIds = [...byWeek.keys()].sort();
  for (const weekId of weekIds) {
    const fileRows = byWeek.get(weekId)!;
    const existing = existingByWeek.get(weekId) ?? [];
    const note = ctx.notes[weekId];
    const hasRecords = existing.length > 0 || (note !== undefined && !note.empty);
    const action: WeekAction = hasRecords ? (choices.weekActions?.[weekId] ?? "merge") : "import";
    const itemRows = fileRows.filter((r) => !r.memo);
    const memoRows = fileRows.filter((r) => r.memo);
    const wp: WeekPlan = {
      weekId,
      action,
      fileItems: itemRows.length,
      fileMemo: memoRows.length,
      existingItems: existing.length,
      existingMemoBoxes: note?.empty === false ? note.boxes : 0,
      add: 0,
      duplicates: 0,
      remove: 0,
      byCategory: [],
    };
    // 업무별 비교 표
    const cmp = new Map<string, { name: string; file: number; existing: number }>();
    for (const r of itemRows) {
      const k = categoryKey(r.category);
      const e = cmp.get(k) ?? { name: catByKey.get(k)?.name ?? r.category, file: 0, existing: 0 };
      e.file++;
      cmp.set(k, e);
    }
    for (const it of existing) {
      const c = ctx.categories.find((x) => x.id === it.categoryId);
      if (!c) continue;
      const k = categoryKey(c.name);
      const e = cmp.get(k) ?? { name: c.name, file: 0, existing: 0 };
      e.existing++;
      cmp.set(k, e);
    }
    wp.byCategory = [...cmp.values()];
    plan.weeks.push(wp);
    if (action === "skip") continue;

    // 칸별 이어 붙일 자리(병합 = 기존 뒤, 덮어쓰기·새 주 = 1부터)
    const keep = action === "merge" ? existing : [];
    if (action === "overwrite") {
      plan.deleteItemIds.push(...existing.map((e) => e.id));
      wp.remove = existing.length;
    }
    const seen = new Set(keep.map((e) => itemKey(e.date, e.categoryId, e.depth, e.text)));
    const nextSeq = new Map<string, number>();
    for (const e of keep) {
      const k = `${e.date}|id:${e.categoryId}`;
      nextSeq.set(k, Math.max(nextSeq.get(k) ?? 0, e.seq));
    }
    for (const r of itemRows) {
      const ref = refOf(r.category);
      const rk = refKey(ref);
      if ("id" in ref && seen.has(itemKey(r.date, ref.id, r.depth, r.text))) {
        wp.duplicates++;
        continue;
      }
      if ("id" in ref) seen.add(itemKey(r.date, ref.id, r.depth, r.text));
      const ck = `${r.date}|${rk}`;
      const seq = (nextSeq.get(ck) ?? 0) + 1;
      nextSeq.set(ck, seq);
      plan.inserts.push({
        line: r.line,
        date: r.date,
        cat: ref,
        seq,
        depth: seq === 1 ? 0 : r.depth,
        text: r.text,
      });
      wp.add++;
      const fk = "id" in ref ? ref.id : ref.newKey;
      if (!firstDate.has(fk) || r.date < firstDate.get(fk)!) firstDate.set(fk, r.date);
    }
    if (memoRows.length || action === "overwrite") {
      const lines = memoRows.map((r) => ({ date: r.date, text: r.text, day: r.memo === "day" }));
      if (action === "overwrite") {
        if (lines.length || wp.existingMemoBoxes) plan.memos.push({ weekId, mode: "replace", lines });
      } else if (lines.length) plan.memos.push({ weekId, mode: "add", lines });
      plan.totals.memoLines += lines.length;
    }
    plan.totals.items += wp.add;
    plan.totals.duplicates += wp.duplicates;
    plan.totals.removed += wp.remove;
    if (wp.add || memoRows.length || wp.remove) plan.totals.weeks++;
  }

  // 새 업무: 실제로 가져올 첫 기록의 주 월요일부터, 끝 없음(이번 주까지 이어짐 — 3-7절)
  plan.newCategories = [...newByKey.values()]
    .filter((c) => firstDate.has(c.key))
    .map((c) => ({ ...c, startDate: weekStart(weekIdOf(firstDate.get(c.key)!)) }));
  // 쓰지 않게 된 새 업무를 가리키는 계획은 없음(firstDate가 있어야 inserts가 있음). 순서 번호를 다시 매김
  let o = ctx.categories.reduce((m, c) => Math.max(m, c.sortOrder), 0);
  for (const c of plan.newCategories) c.sortOrder = ++o;

  // 기존 업무: 가져온 첫 기록이 첫 구간보다 앞이면 첫 구간 시작을 그 주 월요일로
  for (const id of matchedIds) {
    const c = ctx.categories.find((x) => x.id === id)!;
    plan.matched.push({ id, name: c.name, ended: !openCats.has(id) });
    const first = firstDate.get(id);
    if (!first) continue;
    const periods = ctx.periods
      .filter((p) => p.categoryId === id)
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
    const p0 = periods[0];
    const monday = weekStart(weekIdOf(first));
    if (p0 && p0.startDate > monday)
      plan.periodMoves.push({ periodId: p0.id, from: p0.startDate, to: monday });
  }
  const ended = new Set(plan.matched.filter((m) => m.ended).map((m) => m.id));
  plan.reopen = (choices.reopen ?? []).filter((id) => ended.has(id));
  return plan;
}
