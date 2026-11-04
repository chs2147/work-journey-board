// @vitest-environment node
// 업무 항목 마감일(improve-1104v10-spec): 도메인 · 중요 업무 묶음 · 저장소 · 마이그레이션 v12 → v13
import { describe, expect, it, vi } from "vitest";
import { cellKey } from "../../src/data/repository";
import { openSqlJsMemory } from "../../src/data/drivers/sqlJs";
import { MIGRATIONS, migrate, quickCheck } from "../../src/data/migrate";
import { uuidv7 } from "../../src/data/ids";
import {
  compareDue,
  daysLeft,
  defaultDue,
  dueKind,
  isDueDate,
  parseDueInput,
  quickDues,
} from "../../src/domain/dueDate";
import { groupImportant, importantBadge } from "../../src/domain/important";
import type { ImportantItem, ItemDraft } from "../../src/domain/types";
import { dueView } from "../../src/ui/board/dueView";
import { freshRepo } from "./helpers";

const TODAY = "2026-10-22"; // 목

describe("dueDate 도메인", () => {
  it("남은 날·상태: 지남 · 오늘 · 7일 안 · 그 뒤", () => {
    expect(daysLeft(TODAY, "2026-10-20")).toBe(-2);
    expect(daysLeft(TODAY, "2026-11-02")).toBe(11); // 달 넘김
    expect(daysLeft("2026-12-30", "2027-01-02")).toBe(3); // 해 넘김
    expect(dueKind(TODAY, "2026-10-21")).toBe("late");
    expect(dueKind(TODAY, TODAY)).toBe("today");
    expect(dueKind(TODAY, "2026-10-29")).toBe("soon"); // 7일
    expect(dueKind(TODAY, "2026-10-30")).toBe("later"); // 8일
  });
  it("꼬리표·배지 글은 색 없이도 구분된다(지남·오늘 마감·D-n)", () => {
    expect(dueView(TODAY, "2026-10-20")).toEqual({
      kind: "late",
      chip: "⏳ 10/20 · 2일 지남",
      short: "2일 지남",
    });
    expect(dueView(TODAY, TODAY)).toEqual({ kind: "today", chip: "⏳ 오늘 마감", short: "오늘 마감" });
    expect(dueView(TODAY, "2026-10-26")).toEqual({ kind: "soon", chip: "⏳ 10/26(월) D-4", short: "D-4" });
    expect(dueView(TODAY, "2026-11-13").chip).toBe("⏳ 11/13(금) D-22");
  });
  it("빠른 단추: 이번 주 금이 지났으면 숨김", () => {
    expect(quickDues(TODAY)).toEqual([
      { key: "today", date: "2026-10-22" },
      { key: "tomorrow", date: "2026-10-23" },
      { key: "thisFri", date: "2026-10-23" },
      { key: "nextMon", date: "2026-10-26" },
      { key: "nextFri", date: "2026-10-30" },
      { key: "twoWeeks", date: "2026-11-05" },
    ]);
    expect(quickDues("2026-10-24").map((q) => q.key)).not.toContain("thisFri"); // 토
    expect(quickDues("2026-10-23").map((q) => q.key)).not.toContain("thisFri"); // 금(오늘 = 오늘 단추)
  });
  it("기본 선택: 이번 주 금, 주말이면 다음 주 금", () => {
    expect(defaultDue(TODAY)).toBe("2026-10-23");
    expect(defaultDue("2026-10-23")).toBe("2026-10-23");
    expect(defaultDue("2026-10-25")).toBe("2026-10-30");
  });
  it("숫자 바로 입력: MMDD·YYYYMMDD, 없는 날짜는 거부", () => {
    expect(parseDueInput("1026", TODAY)).toBe("2026-10-26");
    expect(parseDueInput("20271231", TODAY)).toBe("2027-12-31");
    expect(parseDueInput("101", TODAY)).toBe("2026-01-01");
    expect(parseDueInput("0230", TODAY)).toBeNull();
    expect(parseDueInput("12", TODAY)).toBeNull();
    expect(isDueDate("2026-02-29")).toBe(false);
    expect(isDueDate("2028-02-29")).toBe(true);
    expect(isDueDate(null)).toBe(false);
  });
  it("임박순 비교: 없는 것은 뒤", () => {
    expect(["2026-10-30", null, "2026-10-20"].sort(compareDue)).toEqual(["2026-10-20", "2026-10-30", null]);
  });
});

let n = 0;
const imp = (date: string, extra: Partial<ImportantItem> = {}): ImportantItem => ({
  id: `i${++n}`,
  date,
  categoryId: "c",
  categoryName: "업무 가",
  categoryColor: "c1",
  categoryOrder: 1,
  categoryEnded: false,
  seq: 1,
  depth: 0,
  text: `기록 ${n}`,
  parentText: null,
  flagDoneAt: null,
  ...extra,
});

describe("중요 업무 — 마감일이 있는 업무 묶음", () => {
  it("맨 위, 마감 임박순(지난 것 맨 위) → 같은 마감이면 시작 시각 → 기록 날짜, 날짜 묶음과 겹치지 않음", () => {
    const a = imp("2026-10-21", { dueDate: "2026-10-30" });
    const b = imp("2026-10-15", { dueDate: "2026-10-20" }); // 지남
    const c = imp("2026-10-22", { dueDate: "2026-10-26", startTime: "14:00" });
    const d = imp("2026-10-22", { dueDate: "2026-10-26", startTime: "09:00" });
    const e = imp("2026-10-19"); // 마감 없음 → 지난 날짜
    const g = groupImportant([a, b, c, d, e], TODAY);
    expect(g.map((x) => x.key)).toEqual(["due", "late"]);
    expect(g[0]!.items.map((x) => x.id)).toEqual([b.id, d.id, c.id, a.id]);
    expect(g[1]!.items.map((x) => x.id)).toEqual([e.id]);
    expect(g.flatMap((x) => x.items)).toHaveLength(5);
  });
  it("레일 빨간 점: 마감이 지난 항목도 포함(기록 날짜가 앞으로여도)", () => {
    expect(importantBadge([imp("2026-10-26", { dueDate: "2026-10-21" })], TODAY).late).toBe(true);
    expect(importantBadge([imp("2026-10-15", { dueDate: "2026-10-30" })], TODAY).late).toBe(false);
    expect(importantBadge([imp("2026-10-26")], TODAY).late).toBe(false);
  });
});

const draft = (text: string, extra: Partial<ItemDraft> = {}): ItemDraft => ({
  id: uuidv7(),
  depth: 0,
  text,
  ...extra,
});

describe("저장소 — 마감일", () => {
  it("칸 저장에 마감일이 실리고 목록·검색에 나온다, 잘못된 값은 버림", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("정산", "2026-W43");
    const x = draft("보고서 제출", { flagged: true, dueDate: "2026-10-30" });
    const y = draft("잘못된 마감", { dueDate: "2026-02-30" });
    await repo.saveCell(TODAY, c.id, [x, y]);
    const items = (await repo.getWeek("2026-W43")).items[cellKey(TODAY, c.id)]!;
    expect(items.map((i) => [i.text, i.dueDate ?? null])).toEqual([
      ["보고서 제출", "2026-10-30"],
      ["잘못된 마감", null],
    ]);
    expect((await repo.listImportant()).map((i) => [i.text, i.dueDate])).toEqual([
      ["보고서 제출", "2026-10-30"],
    ]);
    expect((await repo.search("보고서")).hits[0]!.dueDate).toBe("2026-10-30");
    // 지우면 null
    await repo.saveCell(TODAY, c.id, [{ ...x, dueDate: null }, y]);
    expect((await repo.listImportant())[0]!.dueDate ?? null).toBeNull();
  });
});

describe("마이그레이션 v12 → v13(due_date)", () => {
  it("직전 백업, 기존 항목은 마감일 없음, 날짜 모양만 저장", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.slice(0, 12) });
    await db.execute(
      "INSERT INTO category (id, name, color, sort_order, created_at, updated_at) VALUES ('c1', '업무', 'c1', 1, 't', 't')",
    );
    await db.execute(
      "INSERT INTO entry_item (id, date, category_id, seq, text, created_at, updated_at) VALUES ('e1', '2026-10-21', 'c1', 1, '회의', 't', 't')",
    );
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { beforeMigrate: before, migrations: MIGRATIONS.slice(0, 13) })).toBe(13);
    expect(before).toHaveBeenCalledWith(12, 13);
    expect(await db.select("SELECT text, due_date FROM entry_item")).toEqual([
      { text: "회의", due_date: null },
    ]);
    await db.execute("UPDATE entry_item SET due_date = '2026-10-30' WHERE id = 'e1'");
    for (const bad of ["2026/10/30", "26-10-30", "내일", "2026-10-3"])
      await expect(db.execute("UPDATE entry_item SET due_date = ? WHERE id = 'e1'", [bad])).rejects.toThrow();
    expect(await quickCheck(db)).toBe(true);
  });
});
