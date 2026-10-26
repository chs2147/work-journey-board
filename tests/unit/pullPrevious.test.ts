// @vitest-environment node
// 직전 기록 가져오기(improve-1026-spec 3절): 직전 기록일 찾기(주말·연차·4주 한도)·덧붙이기(중복 건너뛰기·세부 항목 소속).
import { describe, expect, it } from "vitest";
import { uuidv7 } from "../../src/data/ids";
import { appendCopies } from "../../src/domain/items";
import type { ItemDraft } from "../../src/domain/types";
import { freshRepo } from "./helpers";

const d = (text: string, depth: 0 | 1 = 0): ItemDraft => ({ id: uuidv7(), depth, text });
const view = (items: ItemDraft[]) => items.map((i) => `${i.depth ? "  · " : "- "}${i.text}`);

describe("덧붙이기(appendCopies)", () => {
  let n = 0;
  const id = () => `new-${++n}`;

  it("빈 칸: 본·세부 항목을 순서대로, 표시는 싣지 않음", () => {
    const { items, added } = appendCopies(
      [d("")],
      [
        { depth: 0, text: "가상 배포 리허설" },
        { depth: 1, text: "로그 점검" },
        { depth: 0, text: "가상 회의" },
      ],
      id,
    );
    expect(added).toBe(3);
    expect(view(items)).toEqual(["- 가상 배포 리허설", "  · 로그 점검", "- 가상 회의"]);
    expect(items.every((i) => !i.flagged && !i.recurrenceId)).toBe(true);
  });

  it("같은 본 항목이 있으면 그 묶음에 없는 세부 항목만 보탠다", () => {
    const target = [d("가상 배포 리허설"), d("로그 점검", 1), d("오늘 따로 쓴 일")];
    const { items, added } = appendCopies(
      target,
      [
        { depth: 0, text: "가상 배포 리허설 " },
        { depth: 1, text: "로그 점검" },
        { depth: 1, text: "결과 공유" },
        { depth: 0, text: "오늘 따로 쓴 일" },
      ],
      id,
    );
    expect(added).toBe(1);
    expect(view(items)).toEqual([
      "- 가상 배포 리허설",
      "  · 로그 점검",
      "  · 결과 공유",
      "- 오늘 따로 쓴 일",
    ]);
    expect(appendCopies(items, [{ depth: 0, text: "오늘 따로 쓴 일" }], id).added).toBe(0);
  });
});

describe("직전 기록일 찾기", () => {
  async function setup() {
    const ctx = await freshRepo();
    const a = await ctx.repo.createCategory("가상 A", "2026-W40");
    const b = await ctx.repo.createCategory("가상 B", "2026-W40");
    const save = (date: string, cat: string, ...texts: string[]) =>
      ctx.repo.saveCell(
        date,
        cat,
        texts.map((t) => d(t.replace(/^\s+/, ""), t.startsWith(" ") ? 1 : 0)),
      );
    return { ...ctx, a: a.id, b: b.id, save };
  }

  it("월요일이면 금요일(주말 건너뜀), 업무별로 따로, 세부 항목 순서 유지", async () => {
    const { repo, a, b, save } = await setup();
    await save("2026-10-22", a, "목 A");
    await save("2026-10-23", a, "금 A", " 금 A 세부");
    await save("2026-10-21", b, "수 B");
    const prev = await repo.previousRecord("2026-10-26", [a]);
    expect(prev).toEqual({
      date: "2026-10-23",
      cells: {
        [a]: [
          { depth: 0, text: "금 A" },
          { depth: 1, text: "금 A 세부" },
        ],
      },
    });
    expect((await repo.previousRecord("2026-10-26", [b]))?.date).toBe("2026-10-21");
    // 전체: 어느 업무든 기록이 있는 가장 가까운 날
    const all = await repo.previousRecord("2026-10-26", [a, b]);
    expect(all?.date).toBe("2026-10-23");
    expect(Object.keys(all!.cells)).toEqual([a]);
    expect(await repo.previousRecordDates("2026-10-26")).toEqual({ [a]: "2026-10-23", [b]: "2026-10-21" });
  });

  it("종일 연차인 날은 건너뛰고(반차는 아님), 4주보다 전은 찾지 않는다", async () => {
    const { repo, a, save } = await setup();
    await save("2026-10-22", a, "목 A");
    await save("2026-10-23", a, "연차 날 급한 일");
    await repo.setDayMark("2026-10-23", "leave");
    expect((await repo.previousRecord("2026-10-26", [a]))?.date).toBe("2026-10-22");
    await repo.setDayMark("2026-10-23", "half_pm");
    expect((await repo.previousRecord("2026-10-26", [a]))?.date).toBe("2026-10-23");
    expect(await repo.previousRecord("2026-11-24", [a])).toBeNull(); // 10/27 이후로만 찾는다
    expect(await repo.previousRecord("2026-11-20", [a])).not.toBeNull();
  });
});
