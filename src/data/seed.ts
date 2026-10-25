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
  }[];
  items: { date: string; categoryId: string; seq: number; depth: number; text: string; flagged?: boolean }[];
  memos: { date: string; text: string }[];
  /** 저장된 주간 요약(수정본·AI본) — I-M2 통합 검증용 */
  summaries?: { weekId: string; editedText?: string; aiText?: string }[];
}

export async function seedSample(driver: SqlDriver, data: SampleData, now: Date = new Date()): Promise<void> {
  const ts = now.toISOString();
  const stmts: SqlStatement[] = [];
  for (const c of data.categories) {
    stmts.push(
      {
        sql: "INSERT INTO category (id, name, color, sort_order, nudge_snoozed_until, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
        params: [c.id, c.name, c.color, c.sortOrder, ts, ts],
      },
      {
        sql: "INSERT INTO category_period (id, category_id, start_date, end_date) VALUES (?, ?, ?, ?)",
        params: [uuidv7(), c.id, c.startDate, c.endDate ?? null],
      },
    );
  }
  for (const it of data.items) {
    stmts.push({
      sql: "INSERT INTO entry_item (id, date, category_id, seq, depth, text, flagged, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [uuidv7(), it.date, it.categoryId, it.seq, it.depth, it.text, it.flagged ? 1 : 0, ts, ts],
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
  await driver.batch(stmts);
}
