// 칸반 보드 저장소(docs/improve-v21-spec.md 3·4·6·10절). 상태 변경은 모두 batch 하나 — 첫 문장에서 출처(kanban_ctx)를
// 정하고 마지막 문장에서 되돌린다. 이력 한 줄은 트리거(entry_item_status_log)가 남긴다.
import {
  DONE,
  SECTION_COLORS,
  SECTION_MAX,
  TODO,
  bulkTargets,
  groupCell,
  periodRange,
  recordDayDoneAt,
  sectionKeyOf,
  sectionNameProblem,
  utcRange,
  type BulkOptions,
  type KanbanFilter,
  type KanbanSection,
  type SectionColor,
  type SectionKey,
} from "../domain/kanban";
import { utcTimestamp } from "../domain/localTime";
import type { DateStr } from "../domain/week";
import type { SqlDriver, SqlParam, SqlStatement } from "./driver";
import { uuidv7 } from "./ids";

export type StatusSource = "kanban" | "board" | "important" | "bulk" | "section";

export class KanbanError extends Error {
  constructor(readonly problem: "empty" | "long" | "reserved" | "duplicate" | "max" | "missing") {
    super(problem);
  }
}

export interface KanbanChild {
  id: string;
  text: string;
  done: boolean;
}

export interface KanbanCard {
  id: string;
  date: DateStr;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  categoryOrder: number;
  seq: number;
  text: string;
  flagged: boolean;
  flagDoneAt: string | null;
  sectionId: string | null;
  /** 지금 섹션에 들어온 시각(이력 마지막 줄, 없으면 null) */
  sectionSince: string | null;
  dueDate: string | null;
  startTime: string | null;
  recurrenceId: string | null;
  children: KanbanChild[];
  memoCount: number;
  cabinetCount: number;
}

export interface StatusLogRow {
  fromKey: string;
  fromName: string;
  toKey: string;
  toName: string;
  changedAt: string;
  source: string;
}

export interface BulkInfo {
  id: string;
  createdAt: string;
  count: number;
  undone: boolean;
}

/** 옮기기 되돌리기 자료 — 이전 상태 그대로 */
export interface MoveUndo {
  items: {
    id: string;
    flagged: number;
    flagDoneAt: string | null;
    completionWasFlagged: number;
    sectionId: string | null;
  }[];
}

interface CardRow {
  id: string;
  date: string;
  category_id: string;
  seq: number;
  depth: number;
  text: string;
  flagged: number;
  flag_done_at: string | null;
  completion_was_flagged: number;
  kanban_section_id: string | null;
  due_date: string | null;
  start_time: string | null;
  recurrence_id: string | null;
  category_name: string;
  category_color: string;
  category_order: number;
}

const COLS = `e.id, e.date, e.category_id, e.seq, e.depth, e.text, e.flagged, e.flag_done_at, e.completion_was_flagged,
  e.kanban_section_id, e.due_date, e.start_time, e.recurrence_id,
  c.name AS category_name, c.color AS category_color, c.sort_order AS category_order`;

const isDone = (r: { flagged: number; flag_done_at: string | null }) =>
  Number(r.flagged) === 0 && !!r.flag_done_at;

export class KanbanRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly clock: () => Date,
    /** 업무 종료 여부(진행 중 업무만 보기) */
    private readonly endedCategories: () => Promise<Set<string>>,
  ) {}

  private ts() {
    return utcTimestamp(this.clock());
  }

  /** 출처 정하기 → 문장들 → 되돌리기 */
  private wrap(source: StatusSource, stmts: SqlStatement[], batchId: string | null = null): SqlStatement[] {
    return [
      {
        sql: "UPDATE kanban_ctx SET source = ?, batch_id = ?, at = ? WHERE id = 1",
        params: [source, batchId, this.ts()],
      },
      ...stmts,
      { sql: "UPDATE kanban_ctx SET source = 'board', batch_id = NULL, at = NULL WHERE id = 1" },
    ];
  }

  /** 다른 저장소 쓰기(주간 보드 저장 등)도 출처·시각을 맞추도록 감싸 준다 */
  ctxStatements(source: StatusSource): { begin: SqlStatement; end: SqlStatement } {
    const [begin, , end] = this.wrap(source, [{ sql: "SELECT 1" }]);
    return { begin: begin!, end: end! };
  }

  // ── 섹션 ───────────────────────────────────────
  async listSections(): Promise<KanbanSection[]> {
    const rows = await this.db.select<{ id: string; name: string; color: string; sort_order: number }>(
      "SELECT id, name, color, sort_order FROM kanban_section ORDER BY sort_order, created_at",
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: (SECTION_COLORS as readonly string[]).includes(r.color) ? (r.color as SectionColor) : "gray",
      sortOrder: Number(r.sort_order),
    }));
  }

  async createSection(rawName: string, color: SectionColor): Promise<KanbanSection> {
    const list = await this.listSections();
    if (list.length >= SECTION_MAX) throw new KanbanError("max");
    const p = sectionNameProblem(rawName, list);
    if (p) throw new KanbanError(p);
    const s: KanbanSection = {
      id: uuidv7(),
      name: rawName.trim(),
      color: (SECTION_COLORS as readonly string[]).includes(color) ? color : "gray",
      sortOrder: (list.at(-1)?.sortOrder ?? 0) + 1,
    };
    const ts = this.ts();
    await this.db.execute(
      "INSERT INTO kanban_section (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [s.id, s.name, s.color, s.sortOrder, ts, ts],
    );
    return s;
  }

  async updateSection(id: string, patch: { name?: string; color?: SectionColor }): Promise<void> {
    const list = await this.listSections();
    const cur = list.find((s) => s.id === id);
    if (!cur) throw new KanbanError("missing");
    const name = patch.name !== undefined ? patch.name.trim() : cur.name;
    if (patch.name !== undefined) {
      const p = sectionNameProblem(patch.name, list, id);
      if (p) throw new KanbanError(p);
    }
    const color =
      patch.color && (SECTION_COLORS as readonly string[]).includes(patch.color) ? patch.color : cur.color;
    await this.db.execute("UPDATE kanban_section SET name = ?, color = ?, updated_at = ? WHERE id = ?", [
      name,
      color,
      this.ts(),
      id,
    ]);
  }

  /** 사용자 섹션 순서(TODO·DONE은 늘 양끝) */
  async reorderSections(idsInOrder: string[]): Promise<void> {
    await this.db.batch(
      idsInOrder.map((id, i) => ({
        sql: "UPDATE kanban_section SET sort_order = ? WHERE id = ?",
        params: [i + 1, id],
      })),
    );
  }

  /** 섹션 삭제 — 카드는 지우지 않고 TODO로(이력 남김). 되살리기 자료를 돌려준다 */
  async deleteSection(id: string): Promise<{ section: KanbanSection; itemIds: string[] }> {
    const section = (await this.listSections()).find((s) => s.id === id);
    if (!section) throw new KanbanError("missing");
    const items = await this.db.select<{ id: string }>(
      "SELECT id FROM entry_item WHERE kanban_section_id = ?",
      [id],
    );
    await this.db.batch(
      this.wrap("section", [
        { sql: "UPDATE entry_item SET kanban_section_id = NULL WHERE kanban_section_id = ?", params: [id] },
        { sql: "DELETE FROM kanban_section WHERE id = ?", params: [id] },
      ]),
    );
    return { section, itemIds: items.map((r) => r.id) };
  }

  async restoreSection(undo: { section: KanbanSection; itemIds: string[] }): Promise<void> {
    const ts = this.ts();
    const s = undo.section;
    await this.db.batch(
      this.wrap("section", [
        {
          sql: "INSERT OR IGNORE INTO kanban_section (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          params: [s.id, s.name, s.color, s.sortOrder, ts, ts],
        },
        ...chunk(undo.itemIds).map((part) => ({
          sql: `UPDATE entry_item SET kanban_section_id = ? WHERE id IN (${marks(part)}) AND NOT (flagged = 0 AND flag_done_at IS NOT NULL)`,
          params: [s.id, ...part] as SqlParam[],
        })),
      ]),
    );
  }

  // ── 조회 ───────────────────────────────────────
  private async scopeWhere(f: KanbanFilter): Promise<{ sql: string; params: SqlParam[] }> {
    const parts: string[] = [];
    const params: SqlParam[] = [];
    if (f.categories.length) {
      parts.push(`e.category_id IN (${marks(f.categories)})`);
      params.push(...f.categories);
    }
    if (!f.includeEnded) {
      const ended = [...(await this.endedCategories())].filter((id) => !f.categories.includes(id));
      if (ended.length) {
        parts.push(`e.category_id NOT IN (${marks(ended)})`);
        params.push(...ended);
      }
    }
    return { sql: parts.length ? " AND " + parts.join(" AND ") : "", params };
  }

  /** 미완료 카드(TODO·사용자 섹션) — 기간은 기록일 기준 */
  async listOpen(f: KanbanFilter, today: DateStr): Promise<KanbanCard[]> {
    const range = periodRange(f, today);
    const scope = await this.scopeWhere(f);
    const where: string[] = ["e.depth = 0", "NOT (e.flagged = 0 AND e.flag_done_at IS NOT NULL)"];
    const params: SqlParam[] = [];
    if (range.from) {
      where.push("e.date >= ?");
      params.push(range.from);
    }
    if (range.to) {
      where.push("e.date <= ?");
      params.push(range.to);
    }
    const heads = await this.db.select<CardRow>(
      `SELECT ${COLS} FROM entry_item e JOIN category c ON c.id = e.category_id WHERE ${where.join(" AND ")}${scope.sql}`,
      [...params, ...scope.params],
    );
    return this.cards(heads);
  }

  /** 완료 카드(DONE) — 기간은 완료일 기준, 최근 순, offset부터 limit개 + 전체 수 */
  async listDone(
    f: KanbanFilter,
    today: DateStr,
    limit: number,
    offset = 0,
  ): Promise<{ cards: KanbanCard[]; total: number }> {
    const range = utcRange(periodRange(f, today));
    const scope = await this.scopeWhere(f);
    const where: string[] = ["e.depth = 0", "e.flagged = 0", "e.flag_done_at IS NOT NULL"];
    const params: SqlParam[] = [];
    if (range.from) {
      where.push("e.flag_done_at >= ?");
      params.push(range.from);
    }
    if (range.to) {
      where.push("e.flag_done_at < ?");
      params.push(range.to);
    }
    const base = `FROM entry_item e JOIN category c ON c.id = e.category_id WHERE ${where.join(" AND ")}${scope.sql}`;
    const all = [...params, ...scope.params];
    const [cnt] = await this.db.select<{ n: number }>(`SELECT COUNT(*) AS n ${base}`, all);
    const heads = await this.db.select<CardRow>(
      `SELECT ${COLS} ${base} ORDER BY e.flag_done_at DESC, e.id LIMIT ? OFFSET ?`,
      [...all, limit, offset],
    );
    return { cards: await this.cards(heads), total: Number(cnt?.n ?? 0) };
  }

  /** 본 항목 줄들 → 카드(세부 항목·연결 수·섹션 들어온 시각) */
  private async cards(heads: CardRow[]): Promise<KanbanCard[]> {
    if (!heads.length) return [];
    const cells = new Map<string, { date: string; categoryId: string }>();
    for (const h of heads)
      cells.set(`${h.date}|${h.category_id}`, { date: h.date, categoryId: h.category_id });
    const cellRows: {
      id: string;
      date: string;
      category_id: string;
      seq: number;
      depth: number;
      text: string;
      flagged: number;
      flag_done_at: string | null;
    }[] = [];
    const cellList = [...cells.values()];
    for (let i = 0; i < cellList.length; i += 200) {
      const part = cellList.slice(i, i + 200);
      cellRows.push(
        ...(await this.db.select<(typeof cellRows)[number]>(
          `SELECT id, date, category_id, seq, depth, text, flagged, flag_done_at FROM entry_item
           WHERE ${part.map(() => "(date = ? AND category_id = ?)").join(" OR ")}`,
          part.flatMap((c) => [c.date, c.categoryId]),
        )),
      );
    }
    const byCell = new Map<string, typeof cellRows>();
    for (const r of cellRows) {
      const k = `${r.date}|${r.category_id}`;
      (byCell.get(k) ?? byCell.set(k, []).get(k)!).push(r);
    }
    const childrenOf = new Map<string, KanbanChild[]>();
    for (const rows of byCell.values())
      for (const g of groupCell(rows.map((r) => ({ ...r, seq: Number(r.seq), depth: Number(r.depth) }))))
        childrenOf.set(
          g.head.id,
          g.children.map((c) => ({ id: c.id, text: c.text, done: isDone(c) })),
        );
    const ids = heads.map((h) => h.id);
    const memo = new Map<string, number>(),
      cab = new Map<string, number>(),
      since = new Map<string, string>();
    for (const part of chunk(ids)) {
      for (const r of await this.db.select<{ id: string; n: number }>(
        `SELECT entry_id AS id, COUNT(*) AS n FROM (
           SELECT entry_id FROM note_entry_link WHERE entry_id IN (${marks(part)})
           UNION ALL SELECT entry_id FROM cabi_entry_link WHERE entry_id IN (${marks(part)})) GROUP BY entry_id`,
        [...part, ...part],
      ))
        memo.set(r.id, Number(r.n));
      for (const r of await this.db.select<{ id: string; n: number }>(
        `SELECT entry_id AS id, COUNT(*) AS n FROM cabinet_link WHERE entry_id IN (${marks(part)}) GROUP BY entry_id`,
        part,
      ))
        cab.set(r.id, Number(r.n));
      for (const r of await this.db.select<{ id: string; at: string }>(
        `SELECT item_id AS id, MAX(changed_at) AS at FROM item_status_log WHERE item_id IN (${marks(part)}) GROUP BY item_id`,
        part,
      ))
        since.set(r.id, r.at);
    }
    return heads.map((h) => ({
      id: h.id,
      date: h.date,
      categoryId: h.category_id,
      categoryName: h.category_name,
      categoryColor: h.category_color,
      categoryOrder: Number(h.category_order),
      seq: Number(h.seq),
      text: h.text,
      flagged: Number(h.flagged) === 1,
      flagDoneAt: h.flag_done_at,
      sectionId: h.kanban_section_id,
      sectionSince: h.kanban_section_id ? (since.get(h.id) ?? null) : null,
      dueDate: h.due_date ?? null,
      startTime: h.start_time ?? null,
      recurrenceId: h.recurrence_id ?? null,
      children: childrenOf.get(h.id) ?? [],
      memoCount: memo.get(h.id) ?? 0,
      cabinetCount: cab.get(h.id) ?? 0,
    }));
  }

  async statusLog(itemId: string): Promise<StatusLogRow[]> {
    const rows = await this.db.select<{
      from_key: string;
      from_name: string;
      to_key: string;
      to_name: string;
      changed_at: string;
      source: string;
    }>(
      "SELECT from_key, from_name, to_key, to_name, changed_at, source FROM item_status_log WHERE item_id = ? ORDER BY changed_at, id",
      [itemId],
    );
    return rows.map((r) => ({
      fromKey: r.from_key,
      fromName: r.from_name,
      toKey: r.to_key,
      toName: r.to_name,
      changedAt: r.changed_at,
      source: r.source,
    }));
  }

  // ── 옮기기 ───────────────────────────────────────
  private async itemState(ids: string[]) {
    const out: MoveUndo["items"] = [];
    for (const part of chunk(ids))
      out.push(
        ...(
          await this.db.select<{
            id: string;
            flagged: number;
            flag_done_at: string | null;
            completion_was_flagged: number;
            kanban_section_id: string | null;
          }>(
            `SELECT id, flagged, flag_done_at, completion_was_flagged, kanban_section_id FROM entry_item WHERE id IN (${marks(part)})`,
            part,
          )
        ).map((r) => ({
          id: r.id,
          flagged: Number(r.flagged),
          flagDoneAt: r.flag_done_at,
          completionWasFlagged: Number(r.completion_was_flagged),
          sectionId: r.kanban_section_id,
        })),
      );
    return out;
  }

  /** 본 항목과 같은 칸에서 딸린 세부 항목 id(칸 순서 기준) */
  async childIds(id: string): Promise<string[]> {
    const [h] = await this.db.select<{ date: string; category_id: string }>(
      "SELECT date, category_id FROM entry_item WHERE id = ?",
      [id],
    );
    if (!h) return [];
    const rows = await this.db.select<{ id: string; seq: number; depth: number }>(
      "SELECT id, seq, depth FROM entry_item WHERE date = ? AND category_id = ?",
      [h.date, h.category_id],
    );
    const g = groupCell(rows.map((r) => ({ ...r, seq: Number(r.seq), depth: Number(r.depth) }))).find(
      (x) => x.head.id === id,
    );
    return g ? g.children.map((c) => c.id) : [];
  }

  /**
   * 완료 문장: 본 항목 + 아직 안 끝난 세부 항목을 같은 시각으로 완료(D4), 섹션 표시 지움.
   * 주간 보드·중요 업무 목록의 완료(`completeFlag`)도 이 문장을 쓴다.
   */
  completeStatements(id: string, childIds: string[], at: string): SqlStatement[] {
    return [
      {
        sql: `UPDATE entry_item SET completion_was_flagged = flagged, flagged = 0, flag_done_at = ?, kanban_section_id = NULL, updated_at = ?
              WHERE id = ? AND NOT (flagged = 0 AND flag_done_at IS NOT NULL)`,
        params: [at, at, id],
      },
      ...chunk(childIds).map((part) => ({
        sql: `UPDATE entry_item SET completion_was_flagged = flagged, flagged = 0, flag_done_at = ?, updated_at = ?
              WHERE id IN (${marks(part)}) AND NOT (flagged = 0 AND flag_done_at IS NOT NULL)`,
        params: [at, at, ...part] as SqlParam[],
      })),
    ];
  }

  /** 되살리기 문장: 본 항목(★ 복원) + 그 본 항목과 같은 시각에 끝난 세부 항목만(D7) */
  reopenStatements(id: string, childIds: string[], doneAt: string, sectionId: string | null): SqlStatement[] {
    const ts = this.ts();
    return [
      {
        sql: "UPDATE entry_item SET flagged = completion_was_flagged, flag_done_at = NULL, kanban_section_id = ?, updated_at = ? WHERE id = ?",
        params: [sectionId, ts, id],
      },
      ...chunk(childIds).map((part) => ({
        sql: `UPDATE entry_item SET flagged = completion_was_flagged, flag_done_at = NULL, updated_at = ?
              WHERE id IN (${marks(part)}) AND flagged = 0 AND flag_done_at = ?`,
        params: [ts, ...part, doneAt] as SqlParam[],
      })),
    ];
  }

  /** 카드 옮기기 — 이전 상태(되돌리기)와 바뀐 항목 id를 돌려준다 */
  async move(
    id: string,
    to: SectionKey,
    source: StatusSource = "kanban",
  ): Promise<{ undo: MoveUndo; changed: string[] } | null> {
    const [cur] = await this.itemState([id]);
    if (!cur) return null;
    const from = sectionKeyOf({
      flagged: cur.flagged === 1,
      flagDoneAt: cur.flagDoneAt,
      sectionId: cur.sectionId,
    });
    if (from === to) return null;
    if (to !== TODO && to !== DONE && !(await this.listSections()).some((s) => s.id === to))
      throw new KanbanError("missing");
    const children = await this.childIds(id);
    const undo: MoveUndo = { items: await this.itemState([id, ...children]) };
    let stmts: SqlStatement[];
    if (to === DONE) stmts = this.completeStatements(id, children, this.ts());
    else if (from === DONE)
      stmts = this.reopenStatements(id, children, cur.flagDoneAt!, to === TODO ? null : to);
    else
      stmts = [
        {
          sql: "UPDATE entry_item SET kanban_section_id = ?, updated_at = ? WHERE id = ?",
          params: [to === TODO ? null : to, this.ts(), id],
        },
      ];
    await this.db.batch(this.wrap(source, stmts));
    return { undo, changed: [id, ...children] };
  }

  /** 옮기기 되돌리기 — 저장해 둔 상태를 그대로 되씌운다 */
  async restore(undo: MoveUndo, source: StatusSource = "kanban"): Promise<void> {
    const sections = new Set((await this.listSections()).map((s) => s.id));
    await this.db.batch(
      this.wrap(
        source,
        undo.items.map((it) => ({
          sql: "UPDATE entry_item SET flagged = ?, flag_done_at = ?, completion_was_flagged = ?, kanban_section_id = ?, updated_at = ? WHERE id = ?",
          params: [
            it.flagged,
            it.flagDoneAt,
            it.completionWasFlagged,
            it.sectionId && sections.has(it.sectionId) ? it.sectionId : null,
            this.ts(),
            it.id,
          ],
        })),
      ),
    );
  }

  /** 새로 쓴 본 항목들을 사용자 섹션에 둔다(항목 추가 창) */
  async placeInSection(ids: string[], sectionId: string): Promise<void> {
    if (!ids.length) return;
    await this.db.batch(
      this.wrap(
        "kanban",
        chunk(ids).map((part) => ({
          sql: `UPDATE entry_item SET kanban_section_id = ? WHERE id IN (${marks(part)}) AND depth = 0`,
          params: [sectionId, ...part] as SqlParam[],
        })),
      ),
    );
  }

  // ── 일괄 완료(6절) ───────────────────────────────────
  async bulkPreview(
    o: BulkOptions & { includeEnded: boolean },
  ): Promise<{ cards: KanbanCard[]; children: number; categories: number }> {
    const open = await this.listOpen(
      {
        categories: o.categories,
        includeEnded: o.includeEnded,
        period: "custom",
        from: null,
        to: o.before,
        sort: "old",
      },
      o.today,
    );
    const cards = bulkTargets(open, o);
    return {
      cards,
      children: cards.reduce((n, c) => n + c.children.filter((x) => !x.done).length, 0),
      categories: new Set(cards.map((c) => c.categoryId)).size,
    };
  }

  /** 일괄 완료 실행 — mode "record" = 각 항목의 기록일 정오, "now" = 지금 */
  async bulkComplete(
    cards: Pick<KanbanCard, "id" | "date" | "children">[],
    mode: "record" | "now",
  ): Promise<BulkInfo> {
    const id = uuidv7();
    const now = this.ts();
    const pairs: [string, string][] = [];
    const stmts: SqlStatement[] = [];
    for (const c of cards) {
      const at = mode === "record" ? recordDayDoneAt(c.date) : now;
      const kids = c.children.filter((x) => !x.done).map((x) => x.id);
      stmts.push(...this.completeStatements(c.id, kids, at));
      pairs.push([c.id, at], ...kids.map((k) => [k, at] as [string, string]));
    }
    stmts.push({
      sql: "INSERT INTO kanban_bulk (id, created_at, count, items, undone_at) VALUES (?, ?, ?, ?, NULL)",
      params: [id, now, cards.length, JSON.stringify(pairs)],
    });
    await this.db.batch(this.wrap("bulk", stmts, id));
    return { id, createdAt: now, count: cards.length, undone: false };
  }

  async listBulk(limit = 10): Promise<BulkInfo[]> {
    const rows = await this.db.select<{
      id: string;
      created_at: string;
      count: number;
      undone_at: string | null;
    }>("SELECT id, created_at, count, undone_at FROM kanban_bulk ORDER BY created_at DESC LIMIT ?", [limit]);
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      count: Number(r.count),
      undone: !!r.undone_at,
    }));
  }

  /** 일괄 완료 되돌리기 — 그 묶음의 완료 시각 그대로인 항목만 되살린다(그 뒤 손댄 항목은 그대로) */
  async undoBulk(bulkId: string): Promise<number> {
    const [row] = await this.db.select<{ items: string; undone_at: string | null }>(
      "SELECT items, undone_at FROM kanban_bulk WHERE id = ?",
      [bulkId],
    );
    if (!row || row.undone_at) return 0;
    const pairs = JSON.parse(row.items) as [string, string][];
    const byAt = new Map<string, string[]>();
    for (const [id, at] of pairs) (byAt.get(at) ?? byAt.set(at, []).get(at)!).push(id);
    const ts = this.ts();
    const stmts: SqlStatement[] = [];
    for (const [at, ids] of byAt)
      for (const part of chunk(ids))
        stmts.push({
          sql: `UPDATE entry_item SET flagged = completion_was_flagged, flag_done_at = NULL, updated_at = ?
                WHERE id IN (${marks(part)}) AND flagged = 0 AND flag_done_at = ?`,
          params: [ts, ...part, at] as SqlParam[],
        });
    stmts.push({ sql: "UPDATE kanban_bulk SET undone_at = ? WHERE id = ?", params: [ts, bulkId] });
    await this.db.batch(this.wrap("bulk", stmts, bulkId));
    return pairs.length;
  }
}

const marks = (xs: unknown[]) => xs.map(() => "?").join(", ");
function chunk<T>(xs: T[], n = 400): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
