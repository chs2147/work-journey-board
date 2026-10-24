// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cellKey, ValidationError } from "../../src/data/repository";
import { uuidv7 } from "../../src/data/ids";
import type { ItemDraft } from "../../src/domain/types";
import { freshRepo } from "./helpers";

const draft = (text: string, depth: 0 | 1 = 0, id = uuidv7()): ItemDraft => ({ id, depth, text });

describe("업무(카테고리)", () => {
  it("보고 있는 주부터 보이고 다음 주로 자동 이월", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("  차세대 정산 ", "2026-W43");
    expect(c.name).toBe("차세대 정산");
    expect(c.color).toBe("c1");
    expect((await repo.getWeek("2026-W42")).categories).toHaveLength(0);
    expect((await repo.getWeek("2026-W43")).categories.map((v) => v.state)).toEqual(["active"]);
    expect((await repo.getWeek("2026-W60".replace("60", "50"))).categories).toHaveLength(1);
  });

  it("색은 팔레트 순서, 순서는 끝에 추가 · 재정렬", async () => {
    const { repo } = await freshRepo();
    const a = await repo.createCategory("A", "2026-W43");
    const b = await repo.createCategory("B", "2026-W43");
    expect([a.color, b.color, a.sortOrder, b.sortOrder]).toEqual(["c1", "c2", 1, 2]);
    await repo.reorderCategories([b.id, a.id]);
    expect((await repo.getWeek("2026-W43")).categories.map((v) => v.category.name)).toEqual(["B", "A"]);
  });

  it("이름 검증", async () => {
    const { repo } = await freshRepo();
    await expect(repo.createCategory("   ", "2026-W43")).rejects.toBeInstanceOf(ValidationError);
  });

  it("종료: 이번 주엔 흐리게 남고 다음 주부터 사라짐 → 재활성(같은 주면 구간 재개)", async () => {
    const { repo } = await freshRepo(); // 오늘 2026-10-23(금), W43
    const c = await repo.createCategory("A", "2026-W40");
    await repo.archiveCategory(c.id);
    expect((await repo.getWeek("2026-W43")).categories[0]?.state).toBe("ended");
    expect((await repo.getWeek("2026-W44")).categories).toHaveLength(0);
    await repo.reactivateCategory(c.id);
    const { periods } = await repo.listCategories();
    expect(periods).toHaveLength(1);
    expect(periods[0]?.endDate).toBeNull();
  });

  it("지난 종료 후 재활성은 새 구간 — 공백 주에는 안 보임", async () => {
    const { repo, clock } = await freshRepo();
    const c = await repo.createCategory("A", "2026-W40");
    clock.set(2026, 10, 7); // W41
    await repo.archiveCategory(c.id);
    clock.set(2026, 10, 23); // W43
    await repo.reactivateCategory(c.id);
    expect((await repo.getWeek("2026-W42")).categories).toHaveLength(0);
    expect((await repo.getWeek("2026-W43")).categories).toHaveLength(1);
    expect((await repo.listCategories()).periods).toHaveLength(2);
  });

  it("기록 0건인 업무만 실삭제", async () => {
    const { repo } = await freshRepo();
    const a = await repo.createCategory("A", "2026-W43");
    const b = await repo.createCategory("B", "2026-W43");
    await repo.saveCell("2026-10-23", b.id, [draft("기록")]);
    expect(await repo.deleteCategoryIfEmpty(a.id)).toBe(true);
    expect(await repo.deleteCategoryIfEmpty(b.id)).toBe(false);
    expect((await repo.listCategories()).categories.map((c) => c.name)).toEqual(["B"]);
  });
});

describe("셀 저장 (data-spec 2·8-1)", () => {
  it("추가·수정·삭제·순서·깊이를 한 경로로, seq는 1부터 다시", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("A", "2026-W43");
    const x = draft("첫째"),
      y = draft("둘째"),
      z = draft("셋째");
    await repo.saveCell("2026-10-23", c.id, [x, y, z]);
    await repo.saveCell("2026-10-23", c.id, [
      { ...z, text: "셋째(수정)" },
      { ...x, depth: 1 },
    ]); // y 삭제, 순서·깊이 변경
    const items = (await repo.getWeek("2026-W43")).items[cellKey("2026-10-23", c.id)]!;
    expect(items.map((i) => [i.seq, i.depth, i.text])).toEqual([
      [1, 0, "셋째(수정)"],
      [2, 1, "첫째"],
    ]);
  });

  it("빈 항목은 저장 안 함, 첫 항목은 본 항목으로", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("A", "2026-W43");
    const saved = await repo.saveCell("2026-10-23", c.id, [draft("  "), draft("세부였던 것", 1)]);
    expect(saved.map((i) => [i.seq, i.depth])).toEqual([[1, 0]]);
  });

  it("빈 목록이면 셀 비우기", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("A", "2026-W43");
    await repo.saveCell("2026-10-23", c.id, [draft("가")]);
    await repo.saveCell("2026-10-23", c.id, []);
    expect((await repo.getWeek("2026-W43")).items).toEqual({});
  });

  it("다른 셀은 건드리지 않는다", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("A", "2026-W43");
    await repo.saveCell("2026-10-22", c.id, [draft("목요일")]);
    await repo.saveCell("2026-10-23", c.id, [draft("금요일")]);
    await repo.saveCell("2026-10-23", c.id, []);
    expect(Object.keys((await repo.getWeek("2026-W43")).items)).toEqual([cellKey("2026-10-22", c.id)]);
  });

  it("실패하면 셀 전체가 그대로(트랜잭션)", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("A", "2026-W43");
    const keep = draft("유지");
    await repo.saveCell("2026-10-23", c.id, [keep]);
    await expect(repo.saveCell("2026-10-23", "없는-업무", [draft("x")])).rejects.toThrow();
    await expect(
      repo.saveCell("2026-10-23", c.id, [draft("가"), { id: keep.id, depth: 3 as 0, text: "깊이 오류" }]),
    ).rejects.toThrow();
    const items = (await repo.getWeek("2026-W43")).items[cellKey("2026-10-23", c.id)]!;
    expect(items.map((i) => i.text)).toEqual(["유지"]);
  });

  it("종료된 업무의 지난 기록은 그 주에 계속 보인다(기록만 남음)", async () => {
    const { repo, clock } = await freshRepo();
    const c = await repo.createCategory("A", "2026-W40");
    await repo.saveCell("2026-10-02", c.id, [draft("W40 기록")]);
    clock.set(2026, 9, 28); // 구간 끝을 W40 월요일로 만들기 위해 시계를 되돌려 종료
    await repo.archiveCategory(c.id);
    expect((await repo.getWeek("2026-W40")).categories[0]?.state).toBe("ended");
  });
});

describe("일일 메모", () => {
  it("저장·덮어쓰기·비우면 삭제", async () => {
    const { repo } = await freshRepo();
    await repo.saveMemo("2026-10-22", "부서 회의");
    await repo.saveMemo("2026-10-22", "부서 월례 회의");
    expect((await repo.getWeek("2026-W43")).memos).toEqual({ "2026-10-22": "부서 월례 회의" });
    await repo.saveMemo("2026-10-22", "   ");
    expect((await repo.getWeek("2026-W43")).memos).toEqual({});
  });
});

describe("무기록 제안·연간 밀도", () => {
  it("3주 무기록 업무만 제안, 유지하면 침묵", async () => {
    const { repo } = await freshRepo(); // 이번 주 W43
    const a = await repo.createCategory("꾸준", "2026-W36");
    const b = await repo.createCategory("멈춤", "2026-W36");
    for (const day of ["2026-10-01", "2026-10-08", "2026-10-15"])
      await repo.saveCell(day, a.id, [draft("기록")]);
    await repo.saveCell("2026-09-17", b.id, [draft("오래전")]);
    expect(await repo.getNudges()).toEqual([b.id]);
    await repo.snoozeNudge(b.id);
    expect(await repo.getNudges()).toEqual([]);
  });

  it("설정에서 끄면 제안 없음", async () => {
    const { repo } = await freshRepo();
    const b = await repo.createCategory("멈춤", "2026-W36");
    const a = await repo.createCategory("꾸준", "2026-W36");
    for (const day of ["2026-10-01", "2026-10-08", "2026-10-15"])
      await repo.saveCell(day, a.id, [draft("기록")]);
    expect(await repo.getNudges()).toEqual([b.id]);
    await repo.updateSettings({ nudgeWeeks: 0 });
    expect(await repo.getNudges()).toEqual([]);
  });

  it("주별 기록한 날 수(항목 또는 메모, 같은 날 중복 없음)", async () => {
    const { repo } = await freshRepo();
    const a = await repo.createCategory("A", "2026-W43");
    await repo.saveCell("2026-10-19", a.id, [draft("월")]);
    await repo.saveCell("2026-10-20", a.id, [draft("화")]);
    await repo.saveMemo("2026-10-20", "화 메모");
    await repo.saveMemo("2026-10-21", "수 메모");
    const m = await repo.getYearDensity(2026);
    expect(m.get("2026-W43")).toBe(3);
    expect(m.size).toBe(1);
  });
});

describe("설정 (data-spec 3-4)", () => {
  it("기본값 + 부분 변경 + 범위 밖 값은 기본값", async () => {
    const { repo } = await freshRepo();
    expect((await repo.getSettings()).nudgeWeeks).toBe(3);
    const s = await repo.updateSettings({ nudgeWeeks: 5, backup: { dailyKeep: 7 } });
    expect([s.nudgeWeeks, s.backup.dailyKeep, s.backup.monthlyKeep]).toEqual([5, 7, 12]);
    expect((await repo.updateSettings({ nudgeWeeks: 1 })).nudgeWeeks).toBe(3);
  });
});

describe("중요 표시 (important-repeat-spec 2·4-2)", () => {
  it("칸 저장에 표시가 실리고, 표시 없는 저장 경로로 지워지지 않는다(실행 취소로 되살린 항목 포함)", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("A", "2026-W43");
    const x = { ...draft("중요한 일"), flagged: true },
      y = draft("보통 일");
    await repo.saveCell("2026-10-22", c.id, [x, y]);
    let items = (await repo.getWeek("2026-W43")).items[cellKey("2026-10-22", c.id)]!;
    expect(items.map((i) => [i.text, i.flagged])).toEqual([
      ["중요한 일", true],
      ["보통 일", false],
    ]);
    // 지웠다가(실행 취소처럼) 같은 초안으로 되살리면 표시도 돌아온다
    await repo.saveCell("2026-10-22", c.id, [y]);
    await repo.saveCell("2026-10-22", c.id, [x, y]);
    items = (await repo.getWeek("2026-W43")).items[cellKey("2026-10-22", c.id)]!;
    expect(items[0]!.flagged).toBe(true);
  });

  it("목록: 모든 주의 중요 항목, 업무 이름·색·세부 항목의 본 항목 글 포함", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("업무 가", "2026-W40");
    await repo.saveCell("2026-10-01", c.id, [{ ...draft("지난 일"), flagged: true }]);
    await repo.saveCell("2026-10-22", c.id, [draft("본 항목"), { ...draft("세부 중요", 1), flagged: true }]);
    await repo.saveCell("2026-10-23", c.id, [draft("표시 안 함")]);
    const list = await repo.listImportant();
    expect(list.map((i) => [i.date, i.text, i.parentText, i.categoryName, i.categoryColor])).toEqual(
      expect.arrayContaining([
        ["2026-10-01", "지난 일", null, "업무 가", "c1"],
        ["2026-10-22", "세부 중요", "본 항목", "업무 가", "c1"],
      ]),
    );
    expect(list).toHaveLength(2);
  });

  it("처리 완료 → 목록에서 빠지고 최근 완료(7일)에, 되돌리면 다시 목록으로", async () => {
    const { repo, clock } = await freshRepo();
    const c = await repo.createCategory("A", "2026-W43");
    const x = { ...draft("보고서 제출"), flagged: true };
    await repo.saveCell("2026-10-22", c.id, [x]);
    await repo.completeFlag(x.id);
    expect(await repo.listImportant()).toEqual([]);
    expect((await repo.listRecentDone()).map((i) => i.text)).toEqual(["보고서 제출"]);
    const item = (await repo.getWeek("2026-W43")).items[cellKey("2026-10-22", c.id)]![0]!;
    expect([item.flagged, item.flagDoneAt !== null]).toEqual([false, true]);

    await repo.undoComplete(x.id);
    expect((await repo.listImportant()).map((i) => i.text)).toEqual(["보고서 제출"]);
    expect(await repo.listRecentDone()).toEqual([]);

    // 7일이 지나면 최근 완료에서도 빠진다(기록은 그대로)
    await repo.completeFlag(x.id);
    clock.set(2026, 10, 31); // 처리한 날(10/23)에서 8일 뒤
    expect(await repo.listRecentDone()).toEqual([]);
    expect((await repo.getWeek("2026-W43")).items[cellKey("2026-10-22", c.id)]).toHaveLength(1);
  });

  it("종료된 업무의 중요 항목도 목록에 남고 종료 표시가 붙는다", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("A", "2026-W43");
    await repo.saveCell("2026-10-20", c.id, [{ ...draft("남은 일"), flagged: true }]);
    await repo.archiveCategory(c.id);
    expect((await repo.listImportant()).map((i) => [i.text, i.categoryEnded])).toEqual([["남은 일", true]]);
  });
});
