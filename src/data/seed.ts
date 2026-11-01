// 가상 샘플 시드(브라우저 모드·테스트 전용). 실제 업무 기록을 넣지 않는다(CLAUDE.md 4-2).
import type { SqlDriver, SqlStatement } from "./driver";
import { uuidv7 } from "./ids";

export interface SampleData {
  categories: {
    id: string;
    name: string;
    color: string;
    sortOrder: number;
    startDate: string;
    endDate?: string;
    /** 구간이 여럿(종료 후 재개)이면 이것을 쓴다 */
    periods?: { startDate: string; endDate?: string }[];
  }[];
  items: {
    /** 메모 연결(ref.item) 등에 쓰는 고정 id(없으면 새로 만듦) */
    id?: string;
    date: string;
    categoryId: string;
    seq: number;
    depth: number;
    text: string;
    flagged?: boolean;
  }[];
  memos: { date: string; text: string }[];
  /** 저장된 주간 요약(수정본·AI본) — I-M2 통합 검증용 */
  summaries?: { weekId: string; editedText?: string; aiText?: string }[];
  /** 연차·반차 표시 */
  dayMarks?: { date: string; kind: string }[];
  /** 주간 메모 문서(JSON) — 업무연계 메모 시험용 */
  weekNotes?: { weekId: string; doc: unknown }[];
  /** 메모 이미지(base64) — 성능 측정용 1년치 샘플(optimize-1031-plan O1) */
  assets?: {
    id: string;
    weekId: string;
    mime: string;
    data: string;
    width: number;
    height: number;
    bytes: number;
  }[];
  /** Cabinet 폴더·링크(features-1102-spec F5) — 가상 경로·주소만 */
  cabinet?: {
    items: { id: string; kind: "folder" | "link"; title: string; target: string }[];
    links: { itemId: string; categoryId?: string; entryId?: string }[];
  };
}

export async function seedSample(driver: SqlDriver, data: SampleData, now: Date = new Date()): Promise<void> {
  const ts = now.toISOString();
  const stmts: SqlStatement[] = [];
  for (const c of data.categories) {
    stmts.push({
      sql: "INSERT INTO category (id, name, color, sort_order, nudge_snoozed_until, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
      params: [c.id, c.name, c.color, c.sortOrder, ts, ts],
    });
    for (const p of c.periods ?? [{ startDate: c.startDate, endDate: c.endDate }]) {
      stmts.push({
        sql: "INSERT INTO category_period (id, category_id, start_date, end_date) VALUES (?, ?, ?, ?)",
        params: [uuidv7(), c.id, p.startDate, p.endDate ?? null],
      });
    }
  }
  for (const it of data.items) {
    stmts.push({
      sql: "INSERT INTO entry_item (id, date, category_id, seq, depth, text, flagged, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [
        it.id ?? uuidv7(),
        it.date,
        it.categoryId,
        it.seq,
        it.depth,
        it.text,
        it.flagged ? 1 : 0,
        ts,
        ts,
      ],
    });
  }
  for (const m of data.memos) {
    stmts.push({
      sql: "INSERT INTO day_memo (date, text, updated_at) VALUES (?, ?, ?)",
      params: [m.date, m.text, ts],
    });
  }
  for (const s of data.summaries ?? []) {
    stmts.push({
      sql: "INSERT INTO weekly_summary (week_id, ai_text, ai_saved_at, edited_text, edited_at) VALUES (?, ?, ?, ?, ?)",
      params: [
        s.weekId,
        s.aiText ?? null,
        s.aiText ? ts : null,
        s.editedText ?? null,
        s.editedText ? ts : null,
      ],
    });
  }
  for (const m of data.dayMarks ?? []) {
    stmts.push({
      sql: "INSERT INTO day_mark (date, kind, updated_at) VALUES (?, ?, ?)",
      params: [m.date, m.kind, ts],
    });
  }
  for (const n of data.weekNotes ?? []) {
    stmts.push({
      sql: "INSERT INTO week_note (week_id, doc, updated_at) VALUES (?, ?, ?)",
      params: [n.weekId, JSON.stringify(n.doc), ts],
    });
  }
  for (const a of data.assets ?? []) {
    stmts.push({
      sql: "INSERT INTO note_asset (id, week_id, mime, data, width, height, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      params: [a.id, a.weekId, a.mime, a.data, a.width, a.height, a.bytes, ts],
    });
  }
  (data.cabinet?.items ?? []).forEach((c, i) =>
    stmts.push({
      sql: "INSERT INTO cabinet_item (id, kind, title, target, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      params: [c.id, c.kind, c.title, c.target, i + 1, ts, ts],
    }),
  );
  for (const l of data.cabinet?.links ?? []) {
    stmts.push({
      sql: "INSERT INTO cabinet_link (id, item_id, category_id, entry_id, created_at) VALUES (?, ?, ?, ?, ?)",
      params: [uuidv7(), l.itemId, l.categoryId ?? null, l.entryId ?? null, ts],
    });
  }
  await driver.batch(stmts);
}
