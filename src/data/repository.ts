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
  memos: Record<DateStr, string>;
}

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

/** 수정본 최대 길이(입력 실수로 거대한 글이 들어가는 것 방지) */
export const SUMMARY_MAX = 20000;

/** 보드 한 주 → 자동 집계 입력(그 주에 보이는 업무, 보드 순서) */
export function summaryInputOf(view: WeekView): SummaryInput {
  return {
    weekId: view.weekId,
    categories: view.categories.map((v) => ({ id: v.category.id, name: v.category.name })),
    items: Object.values(view.items).flat(),
    memos: view.memos,
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
    const memos = await this.db.select<{ date: string; text: string }>(
      "SELECT date, text FROM day_memo WHERE date BETWEEN ? AND ?",
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
      memos: Object.fromEntries(memos.map((m) => [m.date, m.text])),
    };
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

  /**
   * 셀 하나를 통째로 저장(data-spec 8-1): 목록에서 빠진 항목 삭제 + 나머지 id 기준 upsert, 한 트랜잭션.
   * 추가·수정·삭제·순서·깊이 변경이 모두 이 한 경로를 지난다. 저장된 항목을 돌려준다.
   */
  async saveCell(date: DateStr, categoryId: string, drafts: ItemDraft[]): Promise<EntryItem[]> {
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
    await this.db.batch(stmts);
    return items;
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

  /** 일일 메모. 비우면 행을 지운다. */
  async saveMemo(date: DateStr, text: string): Promise<void> {
    if (!DATE_RE.test(date)) throw new ValidationError(`날짜 형식 오류: ${date}`);
    const t = text.trim() ? text.slice(0, 4000) : "";
    if (!t) {
      await this.db.execute("DELETE FROM day_memo WHERE date = ?", [date]);
      return;
    }
    await this.db.execute(
      "INSERT INTO day_memo (date, text, updated_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at",
      [date, t, this.ts()],
    );
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
    const memoRows = await this.db.select<{ date: string }>(
      "SELECT date FROM day_memo WHERE date BETWEEN ? AND ?",
      [from, to],
    );
    const weeksWithAnyRecord = new Set<WeekId>([...itemRows, ...memoRows].map((r) => weekIdOf(r.date)));
    const weeksWithItemsByCategory = new Map<string, Set<WeekId>>();
    for (const r of itemRows) {
      const set = weeksWithItemsByCategory.get(r.category_id) ?? new Set<WeekId>();
      set.add(weekIdOf(r.date));
      weeksWithItemsByCategory.set(r.category_id, set);
    }
    const { categories, periods } = await this.listCategories();
    return nudgeCandidates({
      currentWeek,
      nudgeWeeks: settings.nudgeWeeks,
      categories,
      periodsByCategory: groupPeriods(periods),
      weeksWithAnyRecord,
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
      "SELECT date FROM entry_item WHERE date BETWEEN ? AND ? UNION SELECT date FROM day_memo WHERE date BETWEEN ? AND ?",
      [from, to, from, to],
    );
    const out = new Map<WeekId, number>();
    for (const r of rows) {
      const w = weekIdOf(r.date);
      out.set(w, (out.get(w) ?? 0) + 1);
    }
    return out;
  }
}
