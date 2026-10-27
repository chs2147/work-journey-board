// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cellKey, ValidationError } from "../../src/data/repository";
import type { SqlDriver } from "../../src/data/driver";
import { uuidv7 } from "../../src/data/ids";
import { DEFAULT_SETTINGS, mergeSettings } from "../../src/data/settings";
import { emptyDoc, noteToText, type TextBox } from "../../src/domain/note";
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

  it("saveCells: 받는 칸 먼저 한 batch — 옮긴 행은 id·생성 시각을 지키고 날짜·업무만 바뀐다(improve-1026v2-spec 3-4)", async () => {
    const { repo, db, clock } = await freshRepo();
    const a = await repo.createCategory("A", "2026-W43");
    const b = await repo.createCategory("B", "2026-W43");
    const x = draft("옮길 것"),
      x1 = draft("세부", 1, uuidv7()),
      y = draft("남을 것"),
      z = draft("원래 있던 것");
    await repo.saveCell("2026-10-22", a.id, [x, x1, y]);
    await repo.saveCell("2026-10-23", b.id, [z]);
    const created = async (id: string) =>
      (await db.select<{ created_at: string }>("SELECT created_at FROM entry_item WHERE id = ?", [id]))[0]
        ?.created_at;
    const before = await created(x.id);
    clock.set(2026, 10, 23, 15); // 다시 만들어지면 생성 시각이 바뀐다
    await repo.saveCells([
      { date: "2026-10-23", categoryId: b.id, items: [z, x, x1] },
      { date: "2026-10-22", categoryId: a.id, items: [y] },
    ]);
    const week = await repo.getWeek("2026-W43");
    expect(week.items[cellKey("2026-10-22", a.id)]!.map((i) => i.text)).toEqual(["남을 것"]);
    expect(week.items[cellKey("2026-10-23", b.id)]!.map((i) => [i.id, i.seq, i.depth])).toEqual([
      [z.id, 1, 0],
      [x.id, 2, 0],
      [x1.id, 3, 1],
    ]);
    expect(await created(x.id)).toBe(before);
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

const textBox = (id: string, text: string, y = 0): TextBox => ({
  id,
  kind: "text",
  x: 0,
  y,
  w: 320,
  z: 1,
  bg: null,
  content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
});

/** 예전 버전(v0.2.0)이 남긴 요일 메모 행 — 지금 코드에는 쓰는 경로가 없다 */
const legacyMemo = (db: SqlDriver, date: string, text: string) =>
  db.execute("INSERT INTO day_memo (date, text, updated_at) VALUES (?, ?, '2026-10-01T00:00:00Z')", [
    date,
    text,
  ]);

describe("주간 메모 (weekly-note-spec 5절)", () => {
  it("저장·덮어쓰기, 보드·요약 입력에 실린다", async () => {
    const { repo } = await freshRepo();
    expect(await repo.getWeekNote("2026-W43")).toEqual({ doc: emptyDoc(), legacy: false });
    await repo.saveWeekNote("2026-W43", { v: 1, boxes: [textBox("b1", "부서 회의")] });
    await repo.saveWeekNote("2026-W43", { v: 1, boxes: [textBox("b1", "부서 월례 회의")] });
    const { doc, legacy } = await repo.getWeekNote("2026-W43");
    expect(legacy).toBe(false);
    expect(noteToText(doc)).toBe("부서 월례 회의");
    expect(noteToText((await repo.getWeek("2026-W43")).note)).toBe("부서 월례 회의");
    expect((await repo.getSummaryInput("2026-W43")).memo).toBe("부서 월례 회의");
    expect(noteToText((await repo.getWeek("2026-W42")).note)).toBe("");
  });

  it("허용 밖 노드·마크는 저장할 때 걸러진다(안의 글은 문단으로 살림)", async () => {
    const { repo } = await freshRepo();
    const box = textBox("b1", "x");
    box.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "보임", marks: [{ type: "bold" }, { type: "link" }] }],
        },
        { type: "codeBlock", content: [{ type: "text", text: "코드 글" }] },
      ],
    };
    await repo.saveWeekNote("2026-W43", { v: 1, boxes: [box] });
    const saved = ((await repo.getWeekNote("2026-W43")).doc.boxes[0] as TextBox).content;
    expect(JSON.stringify(saved)).not.toMatch(/codeBlock|link/);
    expect(saved.content?.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(saved.content?.[1]?.content?.[0]).toEqual({ type: "text", text: "코드 글" });
    expect(JSON.stringify(saved)).toContain('"bold"');
  });

  it("예전 요일 메모: 저장 전에는 상자 1개 글머리 목록으로 보이고, 저장하면(비워도) 다시 나오지 않는다", async () => {
    const { db, repo } = await freshRepo();
    await legacyMemo(db, "2026-10-22", "부서 회의\n둘째 줄");
    await legacyMemo(db, "2026-10-19", "주간 계획");
    const first = await repo.getWeekNote("2026-W43");
    expect(first.legacy).toBe(true);
    expect(first.doc.boxes).toHaveLength(1);
    expect(noteToText(first.doc)).toBe("- (월) 주간 계획\n- (목) 부서 회의\n  둘째 줄");
    expect((await repo.getSummaryInput("2026-W43")).memo).toBe(noteToText(first.doc));
    await repo.saveWeekNote("2026-W43", emptyDoc());
    expect(await repo.getWeekNote("2026-W43")).toEqual({ doc: emptyDoc(), legacy: false });
    // 예전 표는 지우지 않는다(되돌릴 길을 남김)
    expect(await db.select("SELECT date FROM day_memo ORDER BY date")).toHaveLength(2);
  });

  it("메모 이미지: 넣기·읽기·용량, 문서가 안 가리키는 그 주 이미지만 정리, 잘못된 데이터 거부", async () => {
    const { repo } = await freshRepo();
    const png = { mime: "image/png" as const, data: "iVBORw0KGgo=", width: 40, height: 20, bytes: 0 };
    const a = await repo.addNoteAsset("2026-W43", png);
    const b = await repo.addNoteAsset("2026-W43", { ...png, mime: "image/webp" });
    const other = await repo.addNoteAsset("2026-W42", png);
    expect((await repo.getNoteAssets("2026-W43")).map((x) => x.id).sort()).toEqual([a, b].sort());
    expect(await repo.getNoteAssets("2026-W43")).toContainEqual({ id: a, ...png, bytes: 8 });
    expect(await repo.noteAssetStats()).toEqual({ count: 3, bytes: 24 });
    expect(await repo.pruneNoteAssets("2026-W43", [b])).toBe(1);
    expect((await repo.getNoteAssets("2026-W43")).map((x) => x.id)).toEqual([b]);
    expect((await repo.getNoteAssets("2026-W42")).map((x) => x.id)).toEqual([other]); // 다른 주는 그대로
    expect(await repo.pruneNoteAssets("2026-W42", [])).toBe(1);
    await expect(
      repo.addNoteAsset("2026-W43", { ...png, mime: "image/svg+xml" as "image/png" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.addNoteAsset("2026-W43", { ...png, data: "<script>" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(repo.addNoteAsset("2026-W43", { ...png, width: 0 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("이미지만 있는 주도 메모가 있는 주(무기록 판정·연간 미니맵·첫 기록 주)", async () => {
    const { repo } = await freshRepo();
    const doc = {
      v: 1 as const,
      boxes: [{ id: "i", kind: "image" as const, x: 0, y: 0, w: 200, z: 1, asset: "x", caption: "" }],
    };
    await repo.saveWeekNote("2026-W41", doc);
    expect(Object.fromEntries(await repo.getYearDensity(2026))).toEqual({ "2026-W41": 1 });
    expect(await repo.firstRecordWeek()).toBe("2026-W41");
  });

  it("너무 큰 메모는 거부", async () => {
    const { repo } = await freshRepo();
    await expect(
      repo.saveWeekNote("2026-W43", { v: 1, boxes: [textBox("b1", "가".repeat(1_100_000))] }),
    ).rejects.toBeInstanceOf(ValidationError);
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

  it("주별 기록한 날 수는 항목만 센다 — 메모만 있는 주는 1(예전 요일 메모 포함, 빈 메모는 제외)", async () => {
    const { db, repo } = await freshRepo();
    const a = await repo.createCategory("A", "2026-W40");
    await repo.saveCell("2026-10-19", a.id, [draft("월")]);
    await repo.saveCell("2026-10-20", a.id, [draft("화")]);
    await repo.saveWeekNote("2026-W43", { v: 1, boxes: [textBox("b1", "메모")] });
    await repo.saveWeekNote("2026-W42", { v: 1, boxes: [textBox("b1", "메모만")] });
    await repo.saveWeekNote("2026-W41", emptyDoc());
    await legacyMemo(db, "2026-10-01", "예전 메모"); // W40
    const m = await repo.getYearDensity(2026);
    expect(Object.fromEntries(m)).toEqual({ "2026-W43": 2, "2026-W42": 1, "2026-W40": 1 });
    expect(await repo.firstRecordWeek()).toBe("2026-W40");
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

  it("메모 도크: 기본은 자동 높이, 끌어서 정하면 고정. v0.2.2 이전 저장값은 기본 높이(280)면 자동, 아니면 고정", async () => {
    const { repo } = await freshRepo();
    expect((await repo.getSettings()).ui).toMatchObject({ noteDockAuto: true, noteDockHeight: 280 });
    expect(
      (await repo.updateSettings({ ui: { noteDockHeight: 340, noteDockAuto: false } })).ui,
    ).toMatchObject({
      noteDockAuto: false,
      noteDockHeight: 340,
    });
    expect((await repo.updateSettings({ ui: { noteDockAuto: true } })).ui.noteDockAuto).toBe(true);
    const old = (ui: object) => mergeSettings(DEFAULT_SETTINGS, { ui });
    expect(old({ noteDockHeight: 280, noteDockCollapsed: false }).ui.noteDockAuto).toBe(true);
    expect(old({ noteDockHeight: 360, noteDockCollapsed: false }).ui).toMatchObject({
      noteDockAuto: false,
      noteDockHeight: 360,
    });
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

describe("매주 반복 (important-repeat-spec 3·4)", () => {
  const cellOf = async (
    repo: Awaited<ReturnType<typeof freshRepo>>["repo"],
    week: string,
    date: string,
    cat: string,
  ) => (await repo.getWeek(week)).items[cellKey(date, cat)] ?? [];

  it("켜기 → 다음 주에 같은 요일 칸 맨 아래로 묶음째 들어온다, 두 번 불러도 한 번만", async () => {
    const { repo } = await freshRepo(); // 오늘 2026-10-23(금), W43
    const c = await repo.createCategory("팀 운영", "2026-W43");
    const main = draft("주간업무 정리 보고서 작성"),
      sub = draft("팀원 취합", 1);
    await repo.saveCell("2026-10-22", c.id, [main, sub]);
    const rule = await repo.enableRepeat([main.id, sub.id], false);
    expect([rule.weekday, rule.startWeek, rule.lines.length]).toEqual([4, "2026-W44", 2]);
    // 원래 주는 "이미 만든 주" — 다시 안 생김
    expect(await repo.materializeWeek("2026-W43")).toBe(0);

    await repo.saveCell("2026-10-29", c.id, [draft("다른 기록")]);
    expect(await repo.materializeWeek("2026-W44")).toBe(1);
    expect(await repo.materializeWeek("2026-W44")).toBe(0);
    const items = await cellOf(repo, "2026-W44", "2026-10-29", c.id);
    expect(items.map((i) => [i.seq, i.depth, i.text, i.recurrenceId === rule.id])).toEqual([
      [1, 0, "다른 기록", false],
      [2, 0, "주간업무 정리 보고서 작성", true],
      [3, 1, "팀원 취합", true],
    ]);
  });

  it("들어온 항목을 지우면 그 주만 빠진다(다시 안 생김), 미래 주는 예정으로만 보인다", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("팀 운영", "2026-W43");
    const x = draft("주간 보고");
    await repo.saveCell("2026-10-22", c.id, [x]);
    await repo.enableRepeat([x.id], false);
    expect((await repo.previewWeek("2026-W45")).map((p) => p.date)).toEqual(["2026-11-05"]);
    await repo.materializeWeek("2026-W44");
    await repo.saveCell("2026-10-29", c.id, []); // 휴가 주: 지움
    expect(await repo.materializeWeek("2026-W44")).toBe(0);
    expect(await cellOf(repo, "2026-W44", "2026-10-29", c.id)).toEqual([]);
    expect(await repo.previewWeek("2026-W44")).toEqual([]);
  });

  it("끄기: 한 번이라도 들어왔으면 그 주까지만(이후 안 생김), 켠 주에 바로 끄면 규칙째 지움 — 둘 다 되돌리기", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("팀 운영", "2026-W43");
    const x = draft("주간 보고");
    await repo.saveCell("2026-10-22", c.id, [x]);

    const r1 = await repo.enableRepeat([x.id], false);
    const u1 = await repo.disableRepeat(r1.id, "2026-W43");
    expect(u1.kind).toBe("deleted");
    expect(await repo.listRecurrences()).toEqual([]);
    expect((await cellOf(repo, "2026-W43", "2026-10-22", c.id))[0]!.recurrenceId).toBeNull();
    await repo.restoreRepeat(u1);
    expect((await repo.listRecurrences()).map((r) => r.id)).toEqual([r1.id]);
    expect((await cellOf(repo, "2026-W43", "2026-10-22", c.id))[0]!.recurrenceId).toBe(r1.id);

    await repo.materializeWeek("2026-W44");
    const u2 = await repo.disableRepeat(r1.id, "2026-W44");
    expect(u2).toEqual({ kind: "ended", ruleId: r1.id, prevEnd: null });
    expect(await repo.materializeWeek("2026-W45")).toBe(0);
    expect(await cellOf(repo, "2026-W44", "2026-10-29", c.id)).toHaveLength(1); // 들어온 기록은 그대로
    await repo.restoreRepeat(u2);
    expect(await repo.materializeWeek("2026-W45")).toBe(1);
  });

  it("중요로 시작 · 문구 수정은 다음 생성부터 · 종료된 업무엔 안 생김 · 삭제하면 연결만 풀림", async () => {
    const { repo, clock } = await freshRepo();
    const c = await repo.createCategory("팀 운영", "2026-W43");
    const x = { ...draft("주간 보고"), flagged: true };
    await repo.saveCell("2026-10-22", c.id, [x]);
    const rule = await repo.enableRepeat([x.id], true);
    await repo.updateRecurrence(rule.id, { text: "주간 보고서 제출" });
    await repo.materializeWeek("2026-W44");
    const made = (await cellOf(repo, "2026-W44", "2026-10-29", c.id))[0]!;
    expect([made.text, made.flagged]).toEqual(["주간 보고서 제출", true]);

    clock.set(2026, 10, 30); // W44 금요일에 업무 종료
    await repo.archiveCategory(c.id);
    expect(await repo.materializeWeek("2026-W45")).toBe(0);

    await repo.deleteRecurrence(rule.id);
    expect(await repo.listRecurrences()).toEqual([]);
    expect((await cellOf(repo, "2026-W44", "2026-10-29", c.id))[0]!.recurrenceId).toBeNull();
  });

  it("무기록 제안: 자동으로 들어오기만 하고 안 고친 항목은 기록으로 세지 않는다(spec 6절)", async () => {
    const { repo, clock } = await freshRepo(); // 이번 주 W43
    const a = await repo.createCategory("꾸준", "2026-W36");
    const b = await repo.createCategory("반복만", "2026-W36");
    for (const day of ["2026-10-01", "2026-10-08", "2026-10-15"])
      await repo.saveCell(day, a.id, [draft("기록")]);
    const src = draft("주간 보고");
    await repo.saveCell("2026-09-24", b.id, [src]); // W39
    await repo.enableRepeat([src.id], false);
    for (const w of ["2026-W40", "2026-W41", "2026-W42"]) await repo.materializeWeek(w);
    expect(await repo.getNudges()).toEqual([b.id]);
    // 한 번이라도 고치면 실제 기록(고친 시각 ≠ 만든 시각)
    clock.set(2026, 10, 23, 10);
    const w42 = (await repo.getWeek("2026-W42")).items[cellKey("2026-10-15", b.id)]!;
    await repo.saveCell("2026-10-15", b.id, [{ ...w42[0]!, text: "주간 보고(수정)" }]);
    expect(await repo.getNudges()).toEqual([]);
  });
});

describe("주간 요약 수정본(output-spec 2-3)", () => {
  it("저장·덮어쓰기·지우기·되살리기 — AI본 열은 건드리지 않는다", async () => {
    const { db, repo, clock } = await freshRepo();
    expect(await repo.getWeeklySummary("2026-W43")).toMatchObject({ editedText: null, aiText: null });
    await db.execute(
      "INSERT INTO weekly_summary (week_id, ai_text, ai_basis_hash) VALUES ('2026-W43', 'AI', 'h0')",
    );
    await repo.saveEdited("2026-W43", "수정본 1", "h1");
    clock.set(2026, 10, 23, 11);
    await repo.saveEdited("2026-W43", "수정본 2", "h2");
    const s = await repo.getWeeklySummary("2026-W43");
    expect(s).toMatchObject({
      editedText: "수정본 2",
      editedBasisHash: "h2",
      aiText: "AI",
      aiBasisHash: "h0",
    });
    expect(s.editedAt).toBe(new Date(2026, 9, 23, 11).toISOString()); // 마지막 저장 시각(UTC)

    const prev = await repo.deleteEdited("2026-W43");
    expect(await repo.getWeeklySummary("2026-W43")).toMatchObject({ editedText: null, aiText: "AI" });
    await repo.restoreEdited(prev);
    expect(await repo.getWeeklySummary("2026-W43")).toEqual(s);
  });

  it("다른 주와 섞이지 않고, 지나치게 긴 글은 잘라 저장", async () => {
    const { repo } = await freshRepo();
    await repo.saveEdited("2026-W42", "x".repeat(30000), "h");
    expect((await repo.getWeeklySummary("2026-W42")).editedText).toHaveLength(20000);
    expect((await repo.getWeeklySummary("2026-W43")).editedText).toBeNull();
  });
});

describe("인사이트 조회(m3-s1-spec 11-1)", () => {
  it("업무 기록·통계·날짜별 수·주 범위 메모 — 다른 업무·기간 밖은 섞이지 않음", async () => {
    const { repo } = await freshRepo();
    const a = await repo.createCategory("A", "2026-W40");
    const b = await repo.createCategory("B", "2026-W40");
    await repo.saveCell("2026-10-05", a.id, [draft("가"), draft("가-세부", 1)]);
    await repo.saveCell("2026-10-21", a.id, [draft("나")]);
    await repo.saveCell("2026-10-22", b.id, [draft("다")]);
    const entries = await repo.getCategoryEntries(a.id, "2026-10-01", "2026-10-31");
    expect(entries.map((e) => [e.date, e.depth, e.text])).toEqual([
      ["2026-10-05", 0, "가"],
      ["2026-10-05", 1, "가-세부"],
      ["2026-10-21", 0, "나"],
    ]);
    expect(await repo.getCategoryEntries(a.id, "2026-10-10", "2026-10-31")).toHaveLength(1);
    const stats = await repo.getCategoryStats("2026-10-19", "2026-10-25");
    expect(stats.find((s) => s.categoryId === a.id)).toEqual({
      categoryId: a.id,
      first: "2026-10-05",
      last: "2026-10-21",
      inRange: 1,
    });
    expect(await repo.getCategoryDays(a.id)).toEqual([
      { date: "2026-10-05", items: 2 },
      { date: "2026-10-21", items: 1 },
    ]);
    const doc = emptyDoc();
    await repo.saveWeekNote("2026-W43", doc);
    await repo.saveWeekNote("2026-W50", doc);
    expect(Object.keys(await repo.getWeekNotesBetween("2026-W40", "2026-W45"))).toEqual(["2026-W43"]);
  });

  it("활동(m3-s2-spec 10-1): 업무·날짜별 본/세부 수, 첫 본 항목 글, 범위 경계, 빈 글 제외", async () => {
    const { repo } = await freshRepo();
    const a = await repo.createCategory("A", "2026-W40");
    const b = await repo.createCategory("B", "2026-W40");
    await repo.saveCell("2026-10-05", a.id, [draft("첫째"), draft("세부", 1), draft("둘째")]);
    await repo.saveCell("2026-10-06", a.id, [draft("세부만", 1)]); // 첫 항목은 본 항목으로 맞춰진다
    await repo.saveCell("2026-10-11", b.id, [draft("끝날")]);
    await repo.saveCell("2026-10-12", b.id, [draft("범위 밖")]);
    const rows = await repo.getActivity("2026-10-05", "2026-10-11");
    expect(rows).toEqual([
      { categoryId: a.id, date: "2026-10-05", mains: 2, subs: 1, firstText: "첫째" },
      { categoryId: a.id, date: "2026-10-06", mains: 1, subs: 0, firstText: "세부만" },
      { categoryId: b.id, date: "2026-10-11", mains: 1, subs: 0, firstText: "끝날" },
    ]);
  });
});

describe("메모 관계선(note-relation-spec 5-1)", () => {
  it("저장·읽기 왕복에 edges가 남고, 없는 상자를 가리키는 선은 저장할 때 빠진다", async () => {
    const { repo } = await freshRepo();
    const mk = (id: string, x: number): TextBox => ({
      id,
      kind: "text",
      x,
      y: 0,
      w: 160,
      z: 1,
      bg: null,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: id }] }] },
    });
    await repo.saveWeekNote("2026-W43", {
      v: 1,
      boxes: [mk("a", 0), mk("b", 400)],
      edges: [
        { id: "e1", from: "a", to: "b", dir: "both", dash: true, label: "원인" },
        { id: "e2", from: "a", to: "gone", dir: "one", dash: false, label: "" },
      ],
    });
    const { doc } = await repo.getWeekNote("2026-W43");
    expect(doc.edges).toEqual([{ id: "e1", from: "a", to: "b", dir: "both", dash: true, label: "원인" }]);
  });
});
