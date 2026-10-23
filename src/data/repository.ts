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
import { normalizeCell } from "../domain/items";
import { localDate, utcTimestamp } from "../domain/localTime";
import { NUDGE_LOOKBACK_WEEKS, nudgeCandidates, snoozeUntil } from "../domain/nudge";
import type { Category, CategoryPeriod, Depth, EntryItem, ItemDraft } from "../domain/types";
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
import type { SqlDriver, SqlStatement } from "./driver";
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
}

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
      "SELECT id, date, category_id, seq, depth, text FROM entry_item WHERE date BETWEEN ? AND ? ORDER BY date, category_id, seq",
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
        sql: `INSERT INTO entry_item (id, date, category_id, seq, depth, text, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                date = excluded.date, category_id = excluded.category_id, seq = excluded.seq,
                depth = excluded.depth, text = excluded.text,
                updated_at = CASE WHEN entry_item.text <> excluded.text OR entry_item.depth <> excluded.depth
                                    OR entry_item.seq <> excluded.seq OR entry_item.date <> excluded.date
                                    OR entry_item.category_id <> excluded.category_id
                                  THEN excluded.updated_at ELSE entry_item.updated_at END`,
        params: [it.id, it.date, it.categoryId, it.seq, it.depth, it.text, ts, ts],
      })),
    ];
    await this.db.batch(stmts);
    return items;
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
    const itemRows = await this.db.select<{ category_id: string; date: string }>(
      "SELECT DISTINCT category_id, date FROM entry_item WHERE date BETWEEN ? AND ?",
      [from, to],
    );
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
