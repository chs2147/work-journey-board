// 영속 데이터 접근의 유일한 경로(CLAUDE.md 4-3). UI는 이 클래스만 쓰고 SQL을 직접 실행하지 않는다.
import {
  archiveEndDate,
  groupPeriods,
  normalizeCategoryName,
  openPeriod,
  reactivatePlan,
  visibleCategories,
  type VisibleCategory,
} from "../domain/categories";
import type { SummaryInput } from "../domain/aggregate";
import { isDayMarkKind, isLeaveWeek, type DayMarkKind } from "../domain/dayMark";
import { normalizeTagName, tagNameProblem, type Tag } from "../domain/tags";
import type { ExistingItem, ImportContext, ImportPlan } from "../domain/importer";
import {
  docFromDayMemos,
  emptyDoc,
  IMAGE_MIMES,
  importMemoBox,
  isNoteEmpty,
  noteAssetIds,
  noteToText,
  parseNoteDoc,
  positionBelow,
  topZ,
  type ImageMime,
  type NoteDoc,
} from "../domain/note";
import type { ExportWeek } from "../export/excel";
import { normalizeCell } from "../domain/items";
import { localDate, utcTimestamp } from "../domain/localTime";
import { NUDGE_LOOKBACK_WEEKS, nudgeCandidates, snoozeUntil } from "../domain/nudge";
import {
  ruleDate,
  rulesToCreate,
  ruleTiming,
  type Recurrence,
  type RecurrenceLine,
} from "../domain/recurrence";
import type { Category, CategoryPeriod, Depth, EntryItem, ImportantItem, ItemDraft } from "../domain/types";
import {
  addDays,
  addWeeks,
  weekDays,
  weekIdOf,
  weekRange,
  weekStart,
  weeksInIsoYear,
  type DateStr,
  type WeekId,
} from "../domain/week";
import { nextColorKey, type CategoryColorKey, CATEGORY_COLOR_KEYS } from "../shared/palette";
import type { SqlDriver, SqlParam, SqlStatement } from "./driver";
import { uuidv7 } from "./ids";
import { DEFAULT_SETTINGS, mergeSettings, type Settings, type SettingsPatch } from "./settings";

export class ValidationError extends Error {}

export interface WeekView {
  weekId: WeekId;
  days: DateStr[];
  categories: VisibleCategory[];
  /** 키: cellKey(date, categoryId) */
  items: Record<string, EntryItem[]>;
  /** 주간 메모(weekly-note-spec) — 아직 저장한 적 없는 주는 예전 요일 메모를 상자 1개로 보여 준다 */
  note: NoteDoc;
  /** 연차·반차 표시(improve-1026-spec 1절) — 근무인 날은 없다 */
  dayMarks: Record<DateStr, DayMarkKind>;
}

/** 직전 기록 가져오기의 원본(improve-1026-spec 3절) */
export interface PreviousRecord {
  date: DateStr;
  /** 키: 업무 id, 칸 안 순서대로 */
  cells: Record<string, { depth: Depth; text: string }[]>;
}

/** 직전 기록을 찾는 범위(일) — 4주 */
export const PREVIOUS_LOOKBACK_DAYS = 28;
/** 종일 연차인 날은 직전 기록일로 치지 않는다 */
const NOT_LEAVE = "date NOT IN (SELECT date FROM day_mark WHERE kind = 'leave')";

export const cellKey = (date: DateStr, categoryId: string) => `${date}|${categoryId}`;

/** 저장된 주간 요약(AI본·수정본). 자동 집계본은 저장하지 않는다(data-spec 3-3) */
export interface WeeklySummary {
  weekId: WeekId;
  aiText: string | null;
  aiBasisHash: string | null;
  aiSavedAt: string | null;
  editedText: string | null;
  editedBasisHash: string | null;
  editedAt: string | null;
}

interface WeeklySummaryRow {
  ai_text: string | null;
  ai_basis_hash: string | null;
  ai_saved_at: string | null;
  edited_text: string | null;
  edited_basis_hash: string | null;
  edited_at: string | null;
}

/** 메모 문서 최대 크기(문자) — 이미지는 문서 밖(note_asset)에 둔다 */
export const NOTE_MAX = 1_000_000;
/** 메모 이미지 1장 최대(줄인 뒤 저장 크기). 긴 변 1600px WebP는 보통 100~250KB */
export const NOTE_ASSET_MAX_BYTES = 5 * 1024 * 1024;

/** 가져오기 기록 한 줄(설정 > 가져오기 기록) */
export interface ImportBatchInfo {
  id: string;
  fileName: string;
  weeks: number;
  items: number;
  createdAt: string;
  undoneAt: string | null;
}

export interface ImportResult {
  id: string;
  items: number;
  weeks: number;
  newCategories: number;
}

interface ItemSnapshot {
  id: string;
  date: string;
  category_id: string;
  seq: number;
  depth: number;
  text: string;
  flagged: number;
  flag_done_at: string | null;
  recurrence_id: string | null;
  created_at: string;
  updated_at: string;
  import_id: string | null;
}

/** 되돌리기 자료(import_batch.undo_json) */
interface ImportUndo {
  deletedItems: ItemSnapshot[];
  notes: { weekId: WeekId; doc: string | null }[];
  createdCategories: string[];
  periodStarts: { periodId: string; start: DateStr }[];
  reopened: { periodId: string; end: DateStr | null; created?: boolean }[];
}

/** 메모 이미지(weekly-note-spec 5-1). data = base64, bytes = 저장한 그림 크기 */
export interface NoteAsset {
  id: string;
  mime: ImageMime;
  data: string;
  width: number;
  height: number;
  bytes: number;
}

/** 수정본 최대 길이(입력 실수로 거대한 글이 들어가는 것 방지) */
export const SUMMARY_MAX = 20000;

/** 주 목록 from~to(포함, 오래된 주부터). 거꾸로 주면 바로잡는다. 한 번에 최대 10년치 */
export function weekList(from: WeekId, to: WeekId): WeekId[] {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const out: WeekId[] = [];
  for (let w = a; w <= b && out.length < 530; w = addWeeks(w, 1)) out.push(w);
  return out;
}

/** 보드 한 주 → 자동 집계 입력(그 주에 보이는 업무, 보드 순서) */
export function summaryInputOf(view: WeekView): SummaryInput {
  return {
    weekId: view.weekId,
    categories: view.categories.map((v) => ({ id: v.category.id, name: v.category.name })),
    items: Object.values(view.items).flat(),
    memo: noteToText(view.note),
    dayMarks: Object.entries(view.dayMarks).map(([date, kind]) => ({ date, kind })),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  nudge_snoozed_until: string | null;
}
interface PeriodRow {
  id: string;
  category_id: string;
  start_date: string;
  end_date: string | null;
}
interface ItemRow {
  id: string;
  date: string;
  category_id: string;
  seq: number;
  depth: number;
  text: string;
  flagged: number;
  flag_done_at: string | null;
  recurrence_id: string | null;
}
interface ImportantRow extends ItemRow {
  category_name: string;
  category_color: string;
  category_order: number;
  parent_text: string | null;
}

interface RecurrenceRow {
  id: string;
  category_id: string;
  weekday: number;
  start_week: string;
  end_week: string | null;
  flag_on_create: number;
  created_at: string;
}

/** 반복 끄기의 되돌리기 정보(spec 3-1) */
export type RepeatUndo =
  | { kind: "ended"; ruleId: string; prevEnd: WeekId | null }
  | {
      kind: "deleted";
      rule: Recurrence;
      createdAt: string;
      madeWeeks: { week_id: string; created_at: string }[];
      itemIds: string[];
    };

/** 미래 주의 반복 "예정"(저장하지 않음, spec 3-2) */
export interface RepeatPreview {
  rule: Recurrence;
  date: DateStr;
}

const ITEM_COLUMNS = "id, date, category_id, seq, depth, text, flagged, flag_done_at, recurrence_id";
/** 최근 완료 보관 기간(spec 2-4) */
export const RECENT_DONE_DAYS = 7;

const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  color: r.color as CategoryColorKey,
  sortOrder: Number(r.sort_order),
  nudgeSnoozedUntil: r.nudge_snoozed_until,
});
const toPeriod = (r: PeriodRow): CategoryPeriod => ({
  id: r.id,
  categoryId: r.category_id,
  startDate: r.start_date,
  endDate: r.end_date,
});
const toItem = (r: ItemRow): EntryItem => ({
  id: r.id,
  date: r.date,
  categoryId: r.category_id,
  seq: Number(r.seq),
  depth: Number(r.depth) as Depth,
  text: r.text,
  flagged: Number(r.flagged) === 1,
  flagDoneAt: r.flag_done_at,
  recurrenceId: r.recurrence_id,
});

export class JournalRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private ts() {
    return utcTimestamp(this.clock());
  }

  /** 오늘(로컬 날짜) */
  today(): DateStr {
    return localDate(this.clock());
  }

  currentWeek(): WeekId {
    return weekIdOf(this.today());
  }

  // ── 설정 ─────────────────────────────────────────────
  async getSettings(): Promise<Settings> {
    const [row] = await this.db.select<{ value: string }>(
      "SELECT value FROM app_meta WHERE key = 'settings'",
    );
    let stored: unknown;
    try {
      stored = row ? JSON.parse(row.value) : undefined;
    } catch {
      stored = undefined; // 손상된 설정은 기본값으로
    }
    return mergeSettings(structuredClone(DEFAULT_SETTINGS), stored);
  }

  async updateSettings(patch: SettingsPatch): Promise<Settings> {
    const next = mergeSettings(await this.getSettings(), patch);
    await this.db.execute(
      "INSERT INTO app_meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [JSON.stringify(next)],
    );
    return next;
  }

  // ── 업무(카테고리) ──────────────────────────────────
  async listCategories(): Promise<{ categories: Category[]; periods: CategoryPeriod[] }> {
    const cats = await this.db.select<CategoryRow>(
      "SELECT id, name, color, sort_order, nudge_snoozed_until FROM category ORDER BY sort_order",
    );
    const periods = await this.db.select<PeriodRow>(
      "SELECT id, category_id, start_date, end_date FROM category_period ORDER BY category_id, start_date",
    );
    return { categories: cats.map(toCategory), periods: periods.map(toPeriod) };
  }

  /** 새 업무. 보고 있는 주의 월요일부터 보인다(data-spec 4-3). */
  async createCategory(name: string, viewedWeek: WeekId): Promise<Category> {
    const n = normalizeCategoryName(name);
    if (!n) throw new ValidationError("업무 이름은 1~40자여야 합니다");
    const [stat] = await this.db.select<{ n: number; maxOrder: number | null }>(
      "SELECT COUNT(*) AS n, MAX(sort_order) AS maxOrder FROM category",
    );
    const category: Category = {
      id: uuidv7(this.clock().getTime()),
      name: n,
      color: nextColorKey(Number(stat?.n ?? 0)),
      sortOrder: Number(stat?.maxOrder ?? 0) + 1,
      nudgeSnoozedUntil: null,
    };
    const ts = this.ts();
    await this.db.batch([
      {
        sql: "INSERT INTO category (id, name, color, sort_order, nudge_snoozed_until, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
        params: [category.id, category.name, category.color, category.sortOrder, ts, ts],
      },
      {
        sql: "INSERT INTO category_period (id, category_id, start_date, end_date) VALUES (?, ?, ?, NULL)",
        params: [uuidv7(), category.id, weekStart(viewedWeek)],
      },
    ]);
    return category;
  }

  async renameCategory(id: string, name: string): Promise<void> {
    const n = normalizeCategoryName(name);
    if (!n) throw new ValidationError("업무 이름은 1~40자여야 합니다");
    await this.db.execute("UPDATE category SET name = ?, updated_at = ? WHERE id = ?", [n, this.ts(), id]);
  }

  async setCategoryColor(id: string, color: CategoryColorKey): Promise<void> {
    if (!CATEGORY_COLOR_KEYS.includes(color)) throw new ValidationError(`알 수 없는 색: ${color}`);
    await this.db.execute("UPDATE category SET color = ?, updated_at = ? WHERE id = ?", [
      color,
      this.ts(),
      id,
    ]);
  }

  /** 보드 순서 변경: 전달한 순서대로 1, 2, 3 … */
  async reorderCategories(idsInOrder: string[]): Promise<void> {
    const ts = this.ts();
    await this.db.batch(
      idsInOrder.map((id, i) => ({
        sql: "UPDATE category SET sort_order = ?, updated_at = ? WHERE id = ?",
        params: [i + 1, ts, id],
      })),
    );
  }

  private async periodsOf(categoryId: string): Promise<CategoryPeriod[]> {
    const rows = await this.db.select<PeriodRow>(
      "SELECT id, category_id, start_date, end_date FROM category_period WHERE category_id = ? ORDER BY start_date",
      [categoryId],
    );
    return rows.map(toPeriod);
  }

  /** 종료(아카이브): 열린 구간의 끝을 오늘로. 이미 종료면 아무것도 안 함. */
  async archiveCategory(id: string): Promise<void> {
    const open = openPeriod(await this.periodsOf(id));
    if (!open) return;
    await this.db.execute("UPDATE category_period SET end_date = ? WHERE id = ?", [
      archiveEndDate(open, this.today()),
      open.id,
    ]);
  }

  /** 재활성. 이미 진행 중이면 아무것도 안 함. */
  async reactivateCategory(id: string): Promise<void> {
    const periods = await this.periodsOf(id);
    if (openPeriod(periods)) return;
    const plan = reactivatePlan(periods, weekStart(this.currentWeek()));
    const stmts: SqlStatement[] = [
      {
        sql: "UPDATE category SET nudge_snoozed_until = NULL, updated_at = ? WHERE id = ?",
        params: [this.ts(), id],
      },
    ];
    if (plan.kind === "reopen") {
      stmts.push({ sql: "UPDATE category_period SET end_date = NULL WHERE id = ?", params: [plan.periodId] });
    } else {
      stmts.push({
        sql: "INSERT INTO category_period (id, category_id, start_date, end_date) VALUES (?, ?, ?, NULL)",
        params: [uuidv7(), id, plan.startDate],
      });
    }
    await this.db.batch(stmts);
  }

  async countItems(categoryId: string): Promise<number> {
    const [r] = await this.db.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM entry_item WHERE category_id = ?",
      [categoryId],
    );
    return Number(r?.n ?? 0);
  }

  /** 기록이 한 건도 없는 업무만 실삭제(data-spec 6절). 삭제했으면 true. */
  async deleteCategoryIfEmpty(id: string): Promise<boolean> {
    if ((await this.countItems(id)) > 0) return false;
    await this.db.batch([
      { sql: "DELETE FROM category_period WHERE category_id = ?", params: [id] },
      { sql: "DELETE FROM category WHERE id = ?", params: [id] },
    ]);
    return true;
  }

  // ── 주간 보드 ───────────────────────────────────────
  async getWeek(weekId: WeekId): Promise<WeekView> {
    const { start, end } = weekRange(weekId);
    const { categories, periods } = await this.listCategories();
    const rows = await this.db.select<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM entry_item WHERE date BETWEEN ? AND ? ORDER BY date, category_id, seq`,
      [start, end],
    );
    const items: Record<string, EntryItem[]> = {};
    for (const r of rows.map(toItem)) (items[cellKey(r.date, r.categoryId)] ??= []).push(r);
    const withItems = new Set(rows.map((r) => r.category_id));
    return {
      weekId,
      days: weekDays(weekId),
      categories: visibleCategories(categories, periods, start, end, withItems),
      items,
      note: (await this.getWeekNote(weekId)).doc,
      dayMarks: await this.getDayMarks(start, end),
    };
  }

  // ── 연차·반차 표시(improve-1026-spec 1절) ────────────
  async getDayMarks(from: DateStr, to: DateStr): Promise<Record<DateStr, DayMarkKind>> {
    const rows = await this.db.select<{ date: string; kind: string }>(
      "SELECT date, kind FROM day_mark WHERE date BETWEEN ? AND ? ORDER BY date",
      [from, to],
    );
    const out: Record<DateStr, DayMarkKind> = {};
    for (const r of rows) if (isDayMarkKind(r.kind)) out[r.date] = r.kind;
    return out;
  }

  /** 표시 바꾸기. null = 근무(행 삭제) */
  async setDayMark(date: DateStr, kind: DayMarkKind | null): Promise<void> {
    if (!DATE_RE.test(date)) throw new ValidationError(`날짜 형식 오류: ${date}`);
    if (kind === null) {
      await this.db.execute("DELETE FROM day_mark WHERE date = ?", [date]);
      return;
    }
    if (!isDayMarkKind(kind)) throw new ValidationError(`알 수 없는 표시: ${String(kind)}`);
    await this.db.execute(
      "INSERT INTO day_mark (date, kind, updated_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET kind = excluded.kind, updated_at = excluded.updated_at",
      [date, kind, this.ts()],
    );
  }

  // ── 업무 태그(improve-1026-spec 4절) ─────────────────
  async listTags(): Promise<Tag[]> {
    const rows = await this.db.select<{ id: string; name: string; sort_order: number }>(
      "SELECT id, name, sort_order FROM tag ORDER BY sort_order, name",
    );
    return rows.map((r) => ({ id: r.id, name: r.name, sortOrder: Number(r.sort_order) }));
  }

  /** 업무별 태그 id(태그 순서대로). 태그가 없는 업무는 키가 없다 */
  async getCategoryTags(): Promise<Record<string, string[]>> {
    const rows = await this.db.select<{ category_id: string; tag_id: string }>(
      `SELECT ct.category_id, ct.tag_id FROM category_tag ct JOIN tag t ON t.id = ct.tag_id
       ORDER BY t.sort_order, t.name`,
    );
    const out: Record<string, string[]> = {};
    for (const r of rows) (out[r.category_id] ??= []).push(r.tag_id);
    return out;
  }

  private async checkTagName(raw: string, exceptId: string | null): Promise<string> {
    const name = normalizeTagName(raw);
    const others = (await this.listTags()).filter((t) => t.id !== exceptId).map((t) => t.name);
    const problem = tagNameProblem(name, others);
    if (problem) throw new ValidationError(problem);
    return name;
  }

  /** 새 태그(맨 끝 순서). 이름은 1~20자, 대소문자 무시 중복 금지 */
  async createTag(raw: string): Promise<Tag> {
    const name = await this.checkTagName(raw, null);
    const [m] = await this.db.select<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM tag");
    const tag: Tag = { id: uuidv7(this.clock().getTime()), name, sortOrder: Number(m?.m ?? 0) + 1 };
    await this.db.execute("INSERT INTO tag (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)", [
      tag.id,
      tag.name,
      tag.sortOrder,
      this.ts(),
    ]);
    return tag;
  }

  async renameTag(id: string, raw: string): Promise<void> {
    const name = await this.checkTagName(raw, id);
    await this.db.execute("UPDATE tag SET name = ? WHERE id = ?", [name, id]);
  }

  /** 태그 지우기 — 모든 업무에서 떨어진다(category_tag는 외래 키로 함께 지워짐) */
  async deleteTag(id: string): Promise<void> {
    await this.db.execute("DELETE FROM tag WHERE id = ?", [id]);
  }

  async reorderTags(idsInOrder: string[]): Promise<void> {
    await this.db.batch(
      idsInOrder.map((id, i) => ({ sql: "UPDATE tag SET sort_order = ? WHERE id = ?", params: [i + 1, id] })),
    );
  }

  /** 업무에 태그 붙이기/떼기(이미 그 상태면 아무 일 없음) */
  async setCategoryTag(categoryId: string, tagId: string, on: boolean): Promise<void> {
    await this.db.execute(
      on
        ? "INSERT OR IGNORE INTO category_tag (category_id, tag_id) VALUES (?, ?)"
        : "DELETE FROM category_tag WHERE category_id = ? AND tag_id = ?",
      [categoryId, tagId],
    );
  }

  // ── 직전 기록 가져오기(improve-1026-spec 3절) ─────────
  /**
   * before보다 앞선 가장 가까운 기록일(4주 안, 종일 연차 제외)과 그날의 내역.
   * categoryIds를 주면 그 업무들만 본다 — 업무 하나(Alt+P)든 보이는 업무 전체(Alt+Shift+P)든 같은 규칙.
   */
  async previousRecord(before: DateStr, categoryIds: string[]): Promise<PreviousRecord | null> {
    if (!DATE_RE.test(before) || categoryIds.length === 0) return null;
    const from = addDays(before, -PREVIOUS_LOOKBACK_DAYS);
    const inCats = categoryIds.map(() => "?").join(", ");
    const [row] = await this.db.select<{ d: string | null }>(
      `SELECT MAX(date) AS d FROM entry_item
       WHERE date >= ? AND date < ? AND category_id IN (${inCats}) AND trim(text) <> '' AND ${NOT_LEAVE}`,
      [from, before, ...categoryIds],
    );
    if (!row?.d) return null;
    const rows = await this.db.select<{ category_id: string; depth: number; text: string }>(
      `SELECT category_id, depth, text FROM entry_item
       WHERE date = ? AND category_id IN (${inCats}) AND trim(text) <> '' ORDER BY category_id, seq`,
      [row.d, ...categoryIds],
    );
    const cells: PreviousRecord["cells"] = {};
    for (const r of rows)
      (cells[r.category_id] ??= []).push({ depth: Number(r.depth) as Depth, text: r.text });
    return { date: row.d, cells };
  }

  /** 업무별 직전 기록일과 그날 내역(오늘 뷰 카드의 미리보기, spec 8-2) — 키: 업무 id */
  async previousRecordsByCategory(before: DateStr): Promise<PreviousRecord[]> {
    const dates = await this.previousRecordDates(before);
    const pairs = Object.entries(dates);
    if (pairs.length === 0) return [];
    const rows = await this.db.select<{ category_id: string; date: string; depth: number; text: string }>(
      `SELECT category_id, date, depth, text FROM entry_item
       WHERE trim(text) <> '' AND (${pairs.map(() => "(category_id = ? AND date = ?)").join(" OR ")})
       ORDER BY category_id, seq`,
      pairs.flat(),
    );
    const out = new Map<string, PreviousRecord>();
    for (const r of rows) {
      const rec = out.get(r.category_id) ?? { date: r.date, cells: { [r.category_id]: [] } };
      rec.cells[r.category_id]!.push({ depth: Number(r.depth) as Depth, text: r.text });
      out.set(r.category_id, rec);
    }
    return [...out.values()];
  }

  /** 업무별 직전 기록일(빈 칸의 [10/28(수) 내역 가져오기] 단추용) — 키: 업무 id */
  async previousRecordDates(before: DateStr): Promise<Record<string, DateStr>> {
    if (!DATE_RE.test(before)) return {};
    const rows = await this.db.select<{ category_id: string; d: string }>(
      `SELECT category_id, MAX(date) AS d FROM entry_item
       WHERE date >= ? AND date < ? AND trim(text) <> '' AND ${NOT_LEAVE} GROUP BY category_id`,
      [addDays(before, -PREVIOUS_LOOKBACK_DAYS), before],
    );
    return Object.fromEntries(rows.map((r) => [r.category_id, r.d]));
  }

  // ── 주간 메모(weekly-note-spec 5절) ─────────────────
  /**
   * 그 주의 메모 문서. 저장한 적 없는 주는 예전 요일 메모(day_memo)를 상자 1개로 만들어 보여 준다(legacy).
   * 예전 표는 읽기만 하고 지우지 않는다. 처음 저장하면 week_note로 옮겨지고 그 뒤로는 week_note만 본다.
   */
  async getWeekNote(weekId: WeekId): Promise<{ doc: NoteDoc; legacy: boolean }> {
    const [row] = await this.db.select<{ doc: string }>("SELECT doc FROM week_note WHERE week_id = ?", [
      weekId,
    ]);
    if (row) return { doc: parseNoteDoc(row.doc), legacy: false };
    const { start, end } = weekRange(weekId);
    const memos = await this.db.select<{ date: string; text: string }>(
      "SELECT date, text FROM day_memo WHERE date BETWEEN ? AND ?",
      [start, end],
    );
    const doc = docFromDayMemos(weekId, Object.fromEntries(memos.map((m) => [m.date, m.text])), () =>
      uuidv7(this.clock().getTime()),
    );
    return { doc, legacy: doc.boxes.length > 0 };
  }

  /** 메모 문서 저장(통째로). 비어도 행을 남긴다 — 예전 요일 메모가 다시 보이지 않게 */
  async saveWeekNote(weekId: WeekId, doc: NoteDoc): Promise<void> {
    const json = JSON.stringify(parseNoteDoc(JSON.stringify(doc)));
    if (json.length > NOTE_MAX) throw new ValidationError("메모가 너무 큽니다");
    await this.db.execute(
      "INSERT INTO week_note (week_id, doc, updated_at) VALUES (?, ?, ?) ON CONFLICT(week_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at",
      [weekId, json, this.ts()],
    );
  }

  /** 메모 이미지 넣기 — 문서보다 먼저 쓰고, 문서(자동 저장)가 이 id를 가리킨다 */
  async addNoteAsset(weekId: WeekId, a: Omit<NoteAsset, "id">): Promise<string> {
    if (!(IMAGE_MIMES as readonly string[]).includes(a.mime))
      throw new ValidationError("지원하지 않는 그림 형식입니다");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(a.data)) throw new ValidationError("그림 데이터가 올바르지 않습니다");
    const bytes =
      Math.floor((a.data.length * 3) / 4) - (a.data.endsWith("==") ? 2 : a.data.endsWith("=") ? 1 : 0);
    if (bytes > NOTE_ASSET_MAX_BYTES) throw new ValidationError("그림이 너무 큽니다");
    const [w, h] = [Math.round(a.width), Math.round(a.height)];
    if (!(w > 0 && h > 0)) throw new ValidationError("그림 크기가 올바르지 않습니다");
    const id = uuidv7(this.clock().getTime());
    await this.db.execute(
      "INSERT INTO note_asset (id, week_id, mime, data, width, height, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, weekId, a.mime, a.data, w, h, bytes, this.ts()],
    );
    return id;
  }

  async getNoteAssets(weekId: WeekId): Promise<NoteAsset[]> {
    return this.db.select<NoteAsset>(
      "SELECT id, mime, data, width, height, bytes FROM note_asset WHERE week_id = ?",
      [weekId],
    );
  }

  /**
   * 문서가 더는 가리키지 않는 그 주의 이미지 지우기(DB 안의 행 — 사용자 폴더 파일이 아님, 스펙 5-2).
   * 실행 취소로 되살릴 수 있는 동안은 부르지 않는다(주를 옮기거나 앱을 닫을 때만).
   */
  async pruneNoteAssets(weekId: WeekId, keepIds: string[]): Promise<number> {
    const keep = [...new Set([...keepIds, ...(await this.undoAssetIds(weekId))])];
    const marks = keep.map(() => "?").join(", ");
    const { changes } = await this.db.execute(
      `DELETE FROM note_asset WHERE week_id = ?${keep.length ? ` AND id NOT IN (${marks})` : ""}`,
      [weekId, ...keep],
    );
    return changes;
  }

  /** 설정 > 백업의 용량 표시 */
  async noteAssetStats(): Promise<{ count: number; bytes: number }> {
    const [r] = await this.db.select<{ count: number; bytes: number | null }>(
      "SELECT COUNT(*) AS count, SUM(bytes) AS bytes FROM note_asset",
    );
    return { count: r?.count ?? 0, bytes: r?.bytes ?? 0 };
  }

  /** 범위 안에서 메모에 글이 있는 주(예전 요일 메모만 있는 주 포함) */
  private async noteWeeks(from: DateStr, to: DateStr): Promise<Set<WeekId>> {
    const [wa, wb] = [weekIdOf(from), weekIdOf(to)];
    const notes = await this.db.select<{ week_id: string; doc: string }>(
      "SELECT week_id, doc FROM week_note WHERE week_id BETWEEN ? AND ?",
      [wa, wb],
    );
    const saved = new Set(notes.map((n) => n.week_id));
    const out = new Set(notes.filter((n) => !isNoteEmpty(parseNoteDoc(n.doc))).map((n) => n.week_id));
    const legacy = await this.db.select<{ date: string }>(
      "SELECT date FROM day_memo WHERE date BETWEEN ? AND ? AND trim(text) <> ''",
      [from, to],
    );
    for (const r of legacy) {
      const w = weekIdOf(r.date);
      if (!saved.has(w)) out.add(w);
    }
    return out;
  }

  // ── 주간 요약(output-spec 2절) ───────────────────────
  /** 자동 집계 입력 — 보드와 같은 표시 규칙(그 주에 보이는 업무, 보드 순서) */
  async getSummaryInput(weekId: WeekId): Promise<SummaryInput> {
    const view = await this.getWeek(weekId);
    return summaryInputOf(view);
  }

  async getWeeklySummary(weekId: WeekId): Promise<WeeklySummary> {
    const [r] = await this.db.select<WeeklySummaryRow>(
      "SELECT ai_text, ai_basis_hash, ai_saved_at, edited_text, edited_basis_hash, edited_at FROM weekly_summary WHERE week_id = ?",
      [weekId],
    );
    return {
      weekId,
      aiText: r?.ai_text ?? null,
      aiBasisHash: r?.ai_basis_hash ?? null,
      aiSavedAt: r?.ai_saved_at ?? null,
      editedText: r?.edited_text ?? null,
      editedBasisHash: r?.edited_basis_hash ?? null,
      editedAt: r?.edited_at ?? null,
    };
  }

  /** 수정본 저장(AI본 열은 건드리지 않는 upsert). basisHash = 근거 자동 집계본의 해시 */
  async saveEdited(weekId: WeekId, text: string, basisHash: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO weekly_summary (week_id, edited_text, edited_basis_hash, edited_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(week_id) DO UPDATE SET edited_text = excluded.edited_text,
         edited_basis_hash = excluded.edited_basis_hash, edited_at = excluded.edited_at`,
      [weekId, text.slice(0, SUMMARY_MAX), basisHash, this.ts()],
    );
  }

  /** 수정본 지우기. 되돌리기용으로 지우기 전 값을 돌려준다 */
  async deleteEdited(weekId: WeekId): Promise<WeeklySummary> {
    const prev = await this.getWeeklySummary(weekId);
    await this.db.execute(
      "UPDATE weekly_summary SET edited_text = NULL, edited_basis_hash = NULL, edited_at = NULL WHERE week_id = ?",
      [weekId],
    );
    return prev;
  }

  /** 지운 수정본 되살리기(시각까지 그대로) */
  async restoreEdited(prev: WeeklySummary): Promise<void> {
    if (prev.editedText === null) return;
    await this.db.execute(
      `INSERT INTO weekly_summary (week_id, edited_text, edited_basis_hash, edited_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(week_id) DO UPDATE SET edited_text = excluded.edited_text,
         edited_basis_hash = excluded.edited_basis_hash, edited_at = excluded.edited_at`,
      [prev.weekId, prev.editedText, prev.editedBasisHash, prev.editedAt],
    );
  }

  // ── 엑셀 내보내기(output-spec 3·4절) ─────────────────
  /** 기록(항목·메모)이 있는 가장 이른 주. 없으면 null — "전체" 범위의 시작 */
  async firstRecordWeek(): Promise<WeekId | null> {
    const [r] = await this.db.select<{ d: string | null }>(
      "SELECT MIN(date) AS d FROM entry_item WHERE trim(text) <> ''",
    );
    const firstItem = r?.d ? weekIdOf(r.d) : null;
    const notes = [...(await this.noteWeeks("0001-01-01", "9999-12-31"))].sort();
    const firstNote = notes[0] ?? null;
    if (!firstItem) return firstNote;
    return firstNote && firstNote < firstItem ? firstNote : firstItem;
  }

  /** 내보내기 대화상자의 미리 계산: 주 수 · 기록이 있는 업무 수 · 항목 수(메모 제외) */
  async exportStats(from: WeekId, to: WeekId): Promise<{ weeks: number; categories: number; items: number }> {
    const start = weekStart(from);
    const end = weekRange(to).end;
    const [r] = await this.db.select<{ items: number; categories: number }>(
      "SELECT COUNT(*) AS items, COUNT(DISTINCT category_id) AS categories FROM entry_item WHERE date BETWEEN ? AND ? AND trim(text) <> ''",
      [start, end],
    );
    return {
      weeks: weekList(from, to).length,
      categories: Number(r?.categories ?? 0),
      items: Number(r?.items ?? 0),
    };
  }

  /** 내보낼 주별 자료(오래된 주부터): 자동 집계 입력 · 업무 색 · 저장된 본 */
  async exportWeeks(from: WeekId, to: WeekId): Promise<ExportWeek[]> {
    const out: ExportWeek[] = [];
    for (const weekId of weekList(from, to)) {
      const view = await this.getWeek(weekId);
      const saved = await this.getWeeklySummary(weekId);
      out.push({
        input: summaryInputOf(view),
        colors: Object.fromEntries(view.categories.map((v) => [v.category.id, v.category.color])),
        summary: { editedText: saved.editedText, aiText: saved.aiText },
      });
    }
    return out;
  }

  /**
   * 셀 하나를 통째로 저장(data-spec 8-1): 목록에서 빠진 항목 삭제 + 나머지 id 기준 upsert, 한 트랜잭션.
   * 추가·수정·삭제·순서·깊이 변경이 모두 이 한 경로를 지난다. 저장된 항목을 돌려준다.
   */
  async saveCell(date: DateStr, categoryId: string, drafts: ItemDraft[]): Promise<EntryItem[]> {
    const { stmts, items } = this.cellStatements(date, categoryId, drafts);
    await this.db.batch(stmts);
    return items;
  }

  /**
   * 여러 칸을 한 batch로(improve-1026v2-spec 3-4, 행 끌어서 옮기기). **받는 칸을 먼저** 넘긴다 —
   * 같은 id의 upsert가 행의 날짜·업무를 바꾸므로, 그다음 원래 칸의 "목록에 없는 행 삭제"가 옮겨 간 행을 지우지 않는다
   * (순서가 바뀌면 지웠다 새로 만들어 처리 완료 기록·가져오기 묶음 등이 사라진다).
   */
  async saveCells(cells: { date: DateStr; categoryId: string; items: ItemDraft[] }[]): Promise<void> {
    const stmts = cells.flatMap((c) => this.cellStatements(c.date, c.categoryId, c.items).stmts);
    await this.db.batch(stmts);
  }

  private cellStatements(
    date: DateStr,
    categoryId: string,
    drafts: ItemDraft[],
  ): { stmts: SqlStatement[]; items: EntryItem[] } {
    if (!DATE_RE.test(date)) throw new ValidationError(`날짜 형식 오류: ${date}`);
    const items: EntryItem[] = normalizeCell(drafts).map((d, i) => ({
      id: d.id,
      date,
      categoryId,
      seq: i + 1,
      depth: d.depth,
      text: d.text.slice(0, 2000),
      flagged: d.flagged === true,
      flagDoneAt: d.flagged ? null : (d.flagDoneAt ?? null),
      recurrenceId: d.recurrenceId ?? null,
    }));
    const ids = items.map((i) => i.id);
    const ts = this.ts();
    const stmts: SqlStatement[] = [
      {
        sql:
          "DELETE FROM entry_item WHERE date = ? AND category_id = ?" +
          (ids.length ? ` AND id NOT IN (${ids.map(() => "?").join(", ")})` : ""),
        params: [date, categoryId, ...ids],
      },
      ...items.map((it) => ({
        sql: `INSERT INTO entry_item (id, date, category_id, seq, depth, text, flagged, flag_done_at, recurrence_id,
                                      created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                date = excluded.date, category_id = excluded.category_id, seq = excluded.seq,
                depth = excluded.depth, text = excluded.text, flagged = excluded.flagged,
                flag_done_at = excluded.flag_done_at, recurrence_id = excluded.recurrence_id,
                updated_at = CASE WHEN entry_item.text <> excluded.text OR entry_item.depth <> excluded.depth
                                    OR entry_item.seq <> excluded.seq OR entry_item.date <> excluded.date
                                    OR entry_item.category_id <> excluded.category_id
                                    OR entry_item.flagged <> excluded.flagged
                                  THEN excluded.updated_at ELSE entry_item.updated_at END`,
        params: [
          it.id,
          it.date,
          it.categoryId,
          it.seq,
          it.depth,
          it.text,
          it.flagged ? 1 : 0,
          it.flagDoneAt ?? null,
          it.recurrenceId ?? null,
          ts,
          ts,
        ],
      })),
    ];
    return { stmts, items };
  }

  // ── 중요 업무(important-repeat-spec 2절) ──────────────
  private async importantRows(where: string, params: SqlParam[]): Promise<ImportantItem[]> {
    const rows = await this.db.select<ImportantRow>(
      `SELECT e.id, e.date, e.category_id, e.seq, e.depth, e.text, e.flagged, e.flag_done_at, e.recurrence_id,
              c.name AS category_name, c.color AS category_color, c.sort_order AS category_order,
              CASE WHEN e.depth = 1 THEN (
                SELECT p.text FROM entry_item p
                WHERE p.date = e.date AND p.category_id = e.category_id AND p.depth = 0 AND p.seq < e.seq
                ORDER BY p.seq DESC LIMIT 1) END AS parent_text
       FROM entry_item e JOIN category c ON c.id = e.category_id
       WHERE ${where}`,
      params,
    );
    const { periods } = await this.listCategories();
    const groups = groupPeriods(periods);
    return rows.map((r) => ({
      id: r.id,
      date: r.date,
      categoryId: r.category_id,
      categoryName: r.category_name,
      categoryColor: r.category_color,
      categoryOrder: Number(r.category_order),
      categoryEnded: !openPeriod(groups.get(r.category_id) ?? []),
      seq: Number(r.seq),
      depth: Number(r.depth) as Depth,
      text: r.text,
      parentText: r.parent_text,
      flagDoneAt: r.flag_done_at,
    }));
  }

  /** 아직 처리하지 않은 중요 항목 전부(모든 주). 묶음·정렬은 domain/important.ts */
  async listImportant(): Promise<ImportantItem[]> {
    return this.importantRows("e.flagged = 1", []);
  }

  /** 최근 완료(처리 완료 후 RECENT_DONE_DAYS일 이내, 최근 순) */
  async listRecentDone(days = RECENT_DONE_DAYS): Promise<ImportantItem[]> {
    const since = utcTimestamp(new Date(this.clock().getTime() - days * 86_400_000));
    const rows = await this.importantRows("e.flagged = 0 AND e.flag_done_at >= ?", [since]);
    return rows.sort((a, b) => (b.flagDoneAt ?? "").localeCompare(a.flagDoneAt ?? ""));
  }

  /** 중요 업무 목록에서 처리 완료: 강조 해제 + 완료 시각 기록 */
  async completeFlag(id: string): Promise<void> {
    const ts = this.ts();
    await this.db.execute(
      "UPDATE entry_item SET flagged = 0, flag_done_at = ?, updated_at = ? WHERE id = ? AND flagged = 1",
      [ts, ts, id],
    );
  }

  /** 처리 완료 되돌리기: 다시 중요 */
  async undoComplete(id: string): Promise<void> {
    await this.db.execute(
      "UPDATE entry_item SET flagged = 1, flag_done_at = NULL, updated_at = ? WHERE id = ?",
      [this.ts(), id],
    );
  }

  // ── 매주 반복(important-repeat-spec 3절) ───────────────
  async listRecurrences(): Promise<Recurrence[]> {
    const rules = await this.db.select<RecurrenceRow>(
      "SELECT id, category_id, weekday, start_week, end_week, flag_on_create, created_at FROM recurrence ORDER BY weekday, created_at",
    );
    const lines = await this.db.select<{ recurrence_id: string; depth: number; text: string }>(
      "SELECT recurrence_id, depth, text FROM recurrence_line ORDER BY recurrence_id, seq",
    );
    return rules.map((r) => ({
      id: r.id,
      categoryId: r.category_id,
      weekday: Number(r.weekday),
      startWeek: r.start_week,
      endWeek: r.end_week,
      flagOnCreate: Number(r.flag_on_create) === 1,
      lines: lines
        .filter((l) => l.recurrence_id === r.id)
        .map((l) => ({ depth: Number(l.depth) as Depth, text: l.text })),
    }));
  }

  private ruleInsert(rule: Recurrence, createdAt: string, updatedAt: string): SqlStatement[] {
    return [
      {
        sql: "INSERT INTO recurrence (id, category_id, weekday, start_week, end_week, flag_on_create, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params: [
          rule.id,
          rule.categoryId,
          rule.weekday,
          rule.startWeek,
          rule.endWeek,
          rule.flagOnCreate ? 1 : 0,
          createdAt,
          updatedAt,
        ],
      },
      ...rule.lines.map((l, i) => ({
        sql: "INSERT INTO recurrence_line (recurrence_id, seq, depth, text) VALUES (?, ?, ?, ?)",
        params: [rule.id, i + 1, l.depth, l.text],
      })),
    ];
  }

  /** 규칙 지우기: 항목 연결을 풀고 줄·만든 주·규칙을 지운다(외래 키 연쇄 삭제에 기대지 않고 직접) */
  private ruleDelete(id: string): SqlStatement[] {
    return [
      { sql: "UPDATE entry_item SET recurrence_id = NULL WHERE recurrence_id = ?", params: [id] },
      { sql: "DELETE FROM recurrence_line WHERE recurrence_id = ?", params: [id] },
      { sql: "DELETE FROM recurrence_week WHERE recurrence_id = ?", params: [id] },
      { sql: "DELETE FROM recurrence WHERE id = ?", params: [id] },
    ];
  }

  /**
   * 항목 묶음(본 항목 + 세부 항목, 저장된 id 순서대로)에서 반복을 켠다.
   * 요일 = 그 날짜의 요일, 시작 = 다음 주. 원래 항목도 반복에 연결하고 그 주는 "이미 만든 주"로 둔다.
   */
  async enableRepeat(itemIds: string[], flagOnCreate: boolean): Promise<Recurrence> {
    if (itemIds.length === 0) throw new ValidationError("반복할 항목이 없습니다");
    const rows = await this.db.select<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM entry_item WHERE id IN (${itemIds.map(() => "?").join(", ")}) ORDER BY seq`,
      itemIds,
    );
    const first = rows[0];
    if (!first) throw new ValidationError("저장되지 않은 항목은 반복할 수 없습니다");
    const { weekday, startWeek, originWeek } = ruleTiming(first.date);
    const lines: RecurrenceLine[] = rows.map((r, i) => ({
      depth: (i === 0 ? 0 : Number(r.depth)) as Depth,
      text: r.text,
    }));
    const rule: Recurrence = {
      id: uuidv7(),
      categoryId: first.category_id,
      weekday,
      startWeek,
      endWeek: null,
      flagOnCreate,
      lines,
    };
    const ts = this.ts();
    await this.db.batch([
      ...this.ruleInsert(rule, ts, ts),
      {
        sql: `UPDATE entry_item SET recurrence_id = ? WHERE id IN (${rows.map(() => "?").join(", ")})`,
        params: [rule.id, ...rows.map((r) => r.id)],
      },
      {
        sql: "INSERT INTO recurrence_week (recurrence_id, week_id, created_at) VALUES (?, ?, ?)",
        params: [rule.id, originWeek, ts],
      },
    ]);
    return rule;
  }

  /**
   * 반복 끄기: 항목이 있는 주(atWeek)까지만 하고 멈춘다. 한 번도 새로 만든 적 없으면 규칙째 지운다.
   * 이미 들어온 기록은 지우지 않는다. 되돌리기 정보를 돌려준다.
   */
  async disableRepeat(ruleId: string, atWeek: WeekId): Promise<RepeatUndo> {
    const rule = (await this.listRecurrences()).find((r) => r.id === ruleId);
    if (!rule) throw new ValidationError("반복 항목을 찾을 수 없습니다");
    const made = await this.db.select<{ week_id: string; created_at: string }>(
      "SELECT week_id, created_at FROM recurrence_week WHERE recurrence_id = ?",
      [ruleId],
    );
    const ts = this.ts();
    if (!made.some((m) => m.week_id >= rule.startWeek)) {
      const [meta] = await this.db.select<{ created_at: string }>(
        "SELECT created_at FROM recurrence WHERE id = ?",
        [ruleId],
      );
      const linked = await this.db.select<{ id: string }>(
        "SELECT id FROM entry_item WHERE recurrence_id = ?",
        [ruleId],
      );
      await this.db.batch([...this.ruleDelete(ruleId)]);
      return {
        kind: "deleted",
        rule,
        createdAt: meta?.created_at ?? ts,
        madeWeeks: made,
        itemIds: linked.map((r) => r.id),
      };
    }
    await this.db.execute("UPDATE recurrence SET end_week = ?, updated_at = ? WHERE id = ?", [
      atWeek,
      ts,
      ruleId,
    ]);
    return { kind: "ended", ruleId, prevEnd: rule.endWeek };
  }

  /** 반복 끄기 되돌리기 */
  async restoreRepeat(undo: RepeatUndo): Promise<void> {
    const ts = this.ts();
    if (undo.kind === "ended") {
      await this.db.execute("UPDATE recurrence SET end_week = ?, updated_at = ? WHERE id = ?", [
        undo.prevEnd,
        ts,
        undo.ruleId,
      ]);
      return;
    }
    await this.db.batch([
      ...this.ruleInsert(undo.rule, undo.createdAt, ts),
      ...undo.madeWeeks.map((m) => ({
        sql: "INSERT INTO recurrence_week (recurrence_id, week_id, created_at) VALUES (?, ?, ?)",
        params: [undo.rule.id, m.week_id, m.created_at],
      })),
      ...(undo.itemIds.length
        ? [
            {
              sql: `UPDATE entry_item SET recurrence_id = ? WHERE id IN (${undo.itemIds.map(() => "?").join(", ")})`,
              params: [undo.rule.id, ...undo.itemIds],
            },
          ]
        : []),
    ]);
  }

  /** 설정 > 반복 항목: 문구(본 항목)·중요로 시작·중지(끝 주)/다시 시작(null) */
  async updateRecurrence(
    id: string,
    patch: { text?: string; flagOnCreate?: boolean; endWeek?: WeekId | null },
  ): Promise<void> {
    const ts = this.ts();
    const stmts: SqlStatement[] = [];
    if (patch.text !== undefined) {
      const text = patch.text.trim().slice(0, 2000);
      if (!text) throw new ValidationError("반복 문구를 비울 수 없습니다");
      stmts.push({
        sql: "UPDATE recurrence_line SET text = ? WHERE recurrence_id = ? AND seq = 1",
        params: [text, id],
      });
    }
    if (patch.flagOnCreate !== undefined) {
      stmts.push({
        sql: "UPDATE recurrence SET flag_on_create = ? WHERE id = ?",
        params: [patch.flagOnCreate ? 1 : 0, id],
      });
    }
    if (patch.endWeek !== undefined) {
      stmts.push({ sql: "UPDATE recurrence SET end_week = ? WHERE id = ?", params: [patch.endWeek, id] });
    }
    if (!stmts.length) return;
    stmts.push({ sql: "UPDATE recurrence SET updated_at = ? WHERE id = ?", params: [ts, id] });
    await this.db.batch(stmts);
  }

  /** 규칙만 지운다. 이미 들어온 기록은 남고 ↻ 연결만 풀린다(spec 3-5) */
  async deleteRecurrence(id: string): Promise<void> {
    await this.db.batch(this.ruleDelete(id));
  }

  private async pendingRules(weekId: WeekId): Promise<Recurrence[]> {
    const rules = await this.listRecurrences();
    if (!rules.length) return [];
    const made = await this.db.select<{ recurrence_id: string }>(
      "SELECT recurrence_id FROM recurrence_week WHERE week_id = ?",
      [weekId],
    );
    const { periods } = await this.listCategories();
    return rulesToCreate(rules, weekId, new Set(made.map((m) => m.recurrence_id)), groupPeriods(periods));
  }

  /**
   * 반복 항목을 그 주에 넣는다(한 트랜잭션). 칸 맨 아래에 붙이고 그 주를 "이미 만든 주"로 기록한다.
   * 이번 주는 보드를 열 때 자동으로, 미래 주는 "예정"을 눌렀을 때 그 규칙만(onlyRuleId). 만든 묶음 수를 돌려준다.
   */
  async materializeWeek(weekId: WeekId, onlyRuleId?: string): Promise<number> {
    const targets = (await this.pendingRules(weekId)).filter((r) => !onlyRuleId || r.id === onlyRuleId);
    if (!targets.length) return 0;
    const ts = this.ts();
    const stmts: SqlStatement[] = [];
    const nextSeq = new Map<string, number>();
    for (const rule of targets) {
      const date = ruleDate(rule, weekId);
      const key = cellKey(date, rule.categoryId);
      if (!nextSeq.has(key)) {
        const [row] = await this.db.select<{ m: number | null }>(
          "SELECT MAX(seq) AS m FROM entry_item WHERE date = ? AND category_id = ?",
          [date, rule.categoryId],
        );
        nextSeq.set(key, Number(row?.m ?? 0) + 1);
      }
      rule.lines.forEach((line, i) => {
        const seq = nextSeq.get(key)!;
        nextSeq.set(key, seq + 1);
        stmts.push({
          sql: `INSERT INTO entry_item (id, date, category_id, seq, depth, text, flagged, recurrence_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            uuidv7(),
            date,
            rule.categoryId,
            seq,
            line.depth,
            line.text,
            i === 0 && rule.flagOnCreate ? 1 : 0,
            rule.id,
            ts,
            ts,
          ],
        });
      });
      stmts.push({
        sql: "INSERT INTO recurrence_week (recurrence_id, week_id, created_at) VALUES (?, ?, ?)",
        params: [rule.id, weekId, ts],
      });
    }
    await this.db.batch(stmts);
    return targets.length;
  }

  /** 미래 주의 반복 "예정"(저장하지 않음) */
  async previewWeek(weekId: WeekId): Promise<RepeatPreview[]> {
    return (await this.pendingRules(weekId)).map((rule) => ({ rule, date: ruleDate(rule, weekId) }));
  }

  // ── 무기록 종료 제안 ────────────────────────────────
  async getNudges(currentWeek: WeekId = this.currentWeek()): Promise<string[]> {
    const settings = await this.getSettings();
    if (settings.nudgeWeeks <= 0) return [];
    const from = weekStart(addWeeks(currentWeek, -NUDGE_LOOKBACK_WEEKS));
    const to = weekRange(currentWeek).end;
    // 반복으로 자동 생성되고 한 번도 고치지 않은 항목은 기록으로 세지 않는다(spec 6절)
    const raw = await this.db.select<{
      category_id: string;
      date: string;
      recurrence_id: string | null;
      untouched: number;
    }>(
      "SELECT DISTINCT category_id, date, recurrence_id, created_at = updated_at AS untouched FROM entry_item WHERE date BETWEEN ? AND ?",
      [from, to],
    );
    const startWeeks = new Map((await this.listRecurrences()).map((r) => [r.id, r.startWeek]));
    const itemRows = raw.filter((r) => {
      const start = r.recurrence_id ? startWeeks.get(r.recurrence_id) : undefined;
      return !(start && Number(r.untouched) === 1 && weekIdOf(r.date) >= start);
    });
    // "뭐라도 기록한 주" = 업무 항목 또는 주간 메모에 글이 있는 주(data-spec 5-1, weekly-note-spec 6절)
    const weeksWithAnyRecord = new Set<WeekId>([
      ...itemRows.map((r) => weekIdOf(r.date)),
      ...(await this.noteWeeks(from, to)),
    ]);
    const weeksWithItemsByCategory = new Map<string, Set<WeekId>>();
    for (const r of itemRows) {
      const set = weeksWithItemsByCategory.get(r.category_id) ?? new Set<WeekId>();
      set.add(weekIdOf(r.date));
      weeksWithItemsByCategory.set(r.category_id, set);
    }
    const { categories, periods } = await this.listCategories();
    const leaveDates = new Set(
      Object.entries(await this.getDayMarks(from, to))
        .filter(([, k]) => k === "leave")
        .map(([d]) => d),
    );
    const leaveWeeks = new Set(
      [...new Set([...leaveDates].map(weekIdOf))].filter((w) => isLeaveWeek(w, leaveDates)),
    );
    return nudgeCandidates({
      currentWeek,
      nudgeWeeks: settings.nudgeWeeks,
      categories,
      periodsByCategory: groupPeriods(periods),
      weeksWithAnyRecord,
      leaveWeeks,
      weeksWithItemsByCategory,
    });
  }

  /** 종료 제안에 '유지': 이번 주 월요일 + N주 동안 다시 제안하지 않는다. */
  async snoozeNudge(categoryId: string, currentWeek: WeekId = this.currentWeek()): Promise<void> {
    const { nudgeWeeks } = await this.getSettings();
    await this.db.execute("UPDATE category SET nudge_snoozed_until = ?, updated_at = ? WHERE id = ?", [
      snoozeUntil(currentWeek, Math.max(nudgeWeeks, 1)),
      this.ts(),
      categoryId,
    ]);
  }

  // ── 연간 보기(미니맵) ───────────────────────────────
  /** ISO 연도의 주별 "기록한 날 수"(업무 항목 또는 메모가 있는 날) */
  async getYearDensity(isoYear: number): Promise<Map<WeekId, number>> {
    const first = `${isoYear}-W01`;
    const from = weekStart(first);
    const to = weekRange(addWeeks(first, weeksInIsoYear(isoYear) - 1)).end;
    const rows = await this.db.select<{ date: string }>(
      "SELECT DISTINCT date FROM entry_item WHERE date BETWEEN ? AND ?",
      [from, to],
    );
    const out = new Map<WeekId, number>();
    for (const r of rows) {
      const w = weekIdOf(r.date);
      out.set(w, (out.get(w) ?? 0) + 1);
    }
    // 메모에는 날짜가 없다: 업무 기록 없이 메모만 있는 주는 가장 연한 1단계(weekly-note-spec 11절 #8)
    for (const w of await this.noteWeeks(from, to)) if (!out.has(w)) out.set(w, 1);
    return out;
  }

  // ── 기존 일지 가져오기(i-m3-plan 3절) ─────────────────
  /** 가져오기 양식의 `업무` 시트에 미리 채울 업무: 이번 주 진행 중인 업무(보드 순서) */
  async importTemplateCategories(): Promise<string[]> {
    const view = await this.getWeek(this.currentWeek());
    return view.categories.filter((v) => v.state === "active").map((v) => v.category.name);
  }

  /** 계획 세우기에 필요한 이 앱 상태: 업무·구간 전부, 파일에 나온 주들의 항목·주간 메모 */
  async importContext(weekIds: WeekId[]): Promise<ImportContext> {
    const { categories, periods } = await this.listCategories();
    const items: ExistingItem[] = [];
    const notes: ImportContext["notes"] = {};
    for (const w of weekIds) {
      const { start, end } = weekRange(w);
      const rows = await this.db.select<{
        id: string;
        date: string;
        category_id: string;
        seq: number;
        depth: number;
        text: string;
      }>(
        "SELECT id, date, category_id, seq, depth, text FROM entry_item WHERE date BETWEEN ? AND ? ORDER BY date, seq",
        [start, end],
      );
      for (const r of rows)
        items.push({
          id: r.id,
          date: r.date,
          categoryId: r.category_id,
          seq: r.seq,
          depth: r.depth as 0 | 1,
          text: r.text,
        });
      const { doc } = await this.getWeekNote(w);
      notes[w] = { boxes: doc.boxes.length, empty: isNoteEmpty(doc) };
    }
    return {
      today: this.today(),
      categories: categories.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder })),
      periods,
      items,
      notes,
    };
  }

  /**
   * 계획대로 쓰기 — 한 batch(전부 성공 또는 전부 취소, CLAUDE.md 4-3). 가져오기 직전 자동 백업은 부르는 쪽(세션)이 먼저 한다.
   * 가져온 행에는 가져오기 id를 달고, 되돌리기에 필요한 것(덮어쓰기로 지운 행·메모 문서·만든 업무·앞당긴 구간)을 함께 남긴다.
   */
  async applyImport(plan: ImportPlan, fileName: string): Promise<ImportResult> {
    const id = uuidv7(this.clock().getTime());
    const ts = this.ts();
    const stmts: SqlStatement[] = [];
    const undo: ImportUndo = {
      deletedItems: [],
      notes: [],
      createdCategories: [],
      periodStarts: [],
      reopened: [],
    };

    // 새 업무(이번 주까지 이어지는 열린 구간)
    const [stat] = await this.db.select<{ n: number }>("SELECT COUNT(*) AS n FROM category");
    const newIds = new Map<string, string>();
    plan.newCategories.forEach((c, i) => {
      const cid = uuidv7(this.clock().getTime());
      newIds.set(c.key, cid);
      undo.createdCategories.push(cid);
      stmts.push(
        {
          sql: "INSERT INTO category (id, name, color, sort_order, nudge_snoozed_until, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
          params: [cid, c.name, nextColorKey(Number(stat?.n ?? 0) + i), c.sortOrder, ts, ts],
        },
        {
          sql: "INSERT INTO category_period (id, category_id, start_date, end_date) VALUES (?, ?, ?, NULL)",
          params: [uuidv7(), cid, c.startDate],
        },
      );
    });
    for (const m of plan.periodMoves) {
      undo.periodStarts.push({ periodId: m.periodId, start: m.from });
      stmts.push({
        sql: "UPDATE category_period SET start_date = ? WHERE id = ?",
        params: [m.to, m.periodId],
      });
    }
    for (const cid of plan.reopen) {
      const periods = await this.periodsOf(cid);
      if (openPeriod(periods)) continue;
      const rp = reactivatePlan(periods, weekStart(this.currentWeek()));
      if (rp.kind === "reopen") {
        const prev = periods.find((p) => p.id === rp.periodId)!;
        undo.reopened.push({ periodId: rp.periodId, end: prev.endDate });
        stmts.push({ sql: "UPDATE category_period SET end_date = NULL WHERE id = ?", params: [rp.periodId] });
      } else {
        const pid = uuidv7();
        undo.reopened.push({ periodId: pid, end: null, created: true });
        stmts.push({
          sql: "INSERT INTO category_period (id, category_id, start_date, end_date) VALUES (?, ?, ?, NULL)",
          params: [pid, cid, rp.startDate],
        });
      }
    }

    // 덮어쓰기: 그 주의 기존 항목을 지우기 전에 통째로 남긴다
    for (let i = 0; i < plan.deleteItemIds.length; i += 500) {
      const ids = plan.deleteItemIds.slice(i, i + 500);
      undo.deletedItems.push(
        ...(await this.db.select<ItemSnapshot>(
          `SELECT id, date, category_id, seq, depth, text, flagged, flag_done_at, recurrence_id, created_at, updated_at, import_id
           FROM entry_item WHERE id IN (${ids.map(() => "?").join(", ")})`,
          ids,
        )),
      );
      stmts.push({
        sql: `DELETE FROM entry_item WHERE id IN (${ids.map(() => "?").join(", ")})`,
        params: ids,
      });
    }

    for (const it of plan.inserts) {
      const cid = "id" in it.cat ? it.cat.id : newIds.get(it.cat.newKey)!;
      stmts.push({
        sql: `INSERT INTO entry_item (id, date, category_id, seq, depth, text, created_at, updated_at, import_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [uuidv7(this.clock().getTime()), it.date, cid, it.seq, it.depth, it.text, ts, ts, id],
      });
    }

    // 주간 메모: 추가 = 상자 하나 더함, 바꿈 = 그 상자(없으면 빈 메모)로
    for (const m of plan.memos) {
      const [row] = await this.db.select<{ doc: string }>("SELECT doc FROM week_note WHERE week_id = ?", [
        m.weekId,
      ]);
      undo.notes.push({ weekId: m.weekId, doc: row?.doc ?? null });
      const current = m.mode === "add" ? (await this.getWeekNote(m.weekId)).doc : emptyDoc();
      const boxes = m.lines.length
        ? [...current.boxes, importMemoBox(uuidv7(), m.lines, positionBelow(current), topZ(current) + 1)]
        : current.boxes;
      const json = JSON.stringify(parseNoteDoc(JSON.stringify({ v: 1, boxes })));
      stmts.push({
        sql: "INSERT INTO week_note (week_id, doc, updated_at) VALUES (?, ?, ?) ON CONFLICT(week_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at",
        params: [m.weekId, json, ts],
      });
    }

    // 가져오기 기록은 맨 앞에(항목의 import_id가 가리킴)
    stmts.unshift({
      sql: "INSERT INTO import_batch (id, file_name, week_count, item_count, undo_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      params: [id, fileName.slice(0, 200), plan.totals.weeks, plan.totals.items, JSON.stringify(undo), ts],
    });
    await this.db.batch(stmts);
    return {
      id,
      items: plan.totals.items,
      weeks: plan.totals.weeks,
      newCategories: plan.newCategories.length,
    };
  }

  async listImports(): Promise<ImportBatchInfo[]> {
    const rows = await this.db.select<{
      id: string;
      file_name: string;
      week_count: number;
      item_count: number;
      created_at: string;
      undone_at: string | null;
    }>(
      "SELECT id, file_name, week_count, item_count, created_at, undone_at FROM import_batch ORDER BY created_at DESC, rowid DESC",
    );
    return rows.map((r) => ({
      id: r.id,
      fileName: r.file_name,
      weeks: r.week_count,
      items: r.item_count,
      createdAt: r.created_at,
      undoneAt: r.undone_at,
    }));
  }

  /** 가져온 뒤 사용자가 고친 항목 수(되돌리기 확인 문구) */
  async countEditedImported(importId: string): Promise<number> {
    const [r] = await this.db.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM entry_item WHERE import_id = ? AND updated_at <> created_at",
      [importId],
    );
    return Number(r?.n ?? 0);
  }

  /**
   * 가져오기 되돌리기(3-9절 3): 가져온 행 삭제(keepEdited면 고친 행은 남김) + 덮어쓰기로 지운 행·메모 되살림
   * + 앞당긴 구간·다시 시작한 구간 원래대로 + 그 가져오기로 만든 업무는 남은 기록이 없으면 삭제. 한 batch.
   */
  async undoImport(importId: string, keepEdited: boolean): Promise<{ removed: number; restored: number }> {
    const [batch] = await this.db.select<{ undo_json: string; undone_at: string | null }>(
      "SELECT undo_json, undone_at FROM import_batch WHERE id = ?",
      [importId],
    );
    if (!batch || batch.undone_at) return { removed: 0, restored: 0 };
    const undo = JSON.parse(batch.undo_json) as ImportUndo;
    const [cnt] = await this.db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM entry_item WHERE import_id = ?${keepEdited ? " AND updated_at = created_at" : ""}`,
      [importId],
    );
    const stmts: SqlStatement[] = [
      {
        sql: `DELETE FROM entry_item WHERE import_id = ?${keepEdited ? " AND updated_at = created_at" : ""}`,
        params: [importId],
      },
      // 남긴(고친) 행은 손으로 쓴 기록처럼 — 되돌린 가져오기를 가리키지 않게
      { sql: "UPDATE entry_item SET import_id = NULL WHERE import_id = ?", params: [importId] },
    ];
    for (const it of undo.deletedItems)
      stmts.push({
        sql: `INSERT OR IGNORE INTO entry_item (id, date, category_id, seq, depth, text, flagged, flag_done_at, recurrence_id,
                                                created_at, updated_at, import_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          it.id,
          it.date,
          it.category_id,
          it.seq,
          it.depth,
          it.text,
          it.flagged,
          it.flag_done_at,
          it.recurrence_id,
          it.created_at,
          it.updated_at,
          it.import_id,
        ],
      });
    for (const n of undo.notes)
      stmts.push(
        n.doc === null
          ? { sql: "DELETE FROM week_note WHERE week_id = ?", params: [n.weekId] }
          : {
              sql: "INSERT INTO week_note (week_id, doc, updated_at) VALUES (?, ?, ?) ON CONFLICT(week_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at",
              params: [n.weekId, n.doc, this.ts()],
            },
      );
    for (const p of undo.periodStarts)
      stmts.push({
        sql: "UPDATE category_period SET start_date = ? WHERE id = ?",
        params: [p.start, p.periodId],
      });
    for (const p of undo.reopened)
      stmts.push(
        p.created
          ? { sql: "DELETE FROM category_period WHERE id = ?", params: [p.periodId] }
          : { sql: "UPDATE category_period SET end_date = ? WHERE id = ?", params: [p.end, p.periodId] },
      );
    // 만든 업무: 위 삭제 뒤에도 기록이 남지 않으면 함께 지운다(구간은 ON DELETE CASCADE)
    for (const cid of undo.createdCategories)
      stmts.push({
        sql: "DELETE FROM category WHERE id = ? AND NOT EXISTS (SELECT 1 FROM entry_item WHERE category_id = ?)",
        params: [cid, cid],
      });
    stmts.push({ sql: "UPDATE import_batch SET undone_at = ? WHERE id = ?", params: [this.ts(), importId] });
    await this.db.batch(stmts);
    return { removed: Number(cnt?.n ?? 0), restored: undo.deletedItems.length };
  }

  /** 되돌리기로 되살릴 수 있는 메모 문서가 가리키는 그 주 이미지(정리하지 않게) */
  private async undoAssetIds(weekId: WeekId): Promise<string[]> {
    const rows = await this.db.select<{ undo_json: string }>(
      "SELECT undo_json FROM import_batch WHERE undone_at IS NULL AND undo_json LIKE ?",
      [`%${weekId}%`],
    );
    return rows.flatMap((r) =>
      (JSON.parse(r.undo_json) as ImportUndo).notes
        .filter((n) => n.weekId === weekId && n.doc)
        .flatMap((n) => noteAssetIds(parseNoteDoc(n.doc))),
    );
  }
}
