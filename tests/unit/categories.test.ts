import { describe, expect, it } from "vitest";
import {
  archiveEndDate,
  normalizeCategoryName,
  reactivatePlan,
  visibleCategories,
} from "../../src/domain/categories";
import type { Category, CategoryPeriod } from "../../src/domain/types";

const cat = (id: string, sortOrder: number): Category => ({
  id,
  name: id,
  color: "c1",
  sortOrder,
  nudgeSnoozedUntil: null,
});
const per = (
  categoryId: string,
  startDate: string,
  endDate: string | null,
  id = `${categoryId}-${startDate}`,
): CategoryPeriod => ({
  id,
  categoryId,
  startDate,
  endDate,
});

// 2026-W43 = 10/19(월) ~ 10/25(일)
const MON = "2026-10-19";
const SUN = "2026-10-25";
const show = (cats: Category[], periods: CategoryPeriod[], withItems: string[] = []) =>
  visibleCategories(cats, periods, MON, SUN, new Set(withItems)).map((v) => `${v.category.id}:${v.state}`);

describe("주 W에 보일 업무 (data-spec 4-1·4-2)", () => {
  it("열린 구간 → 진행 중, 미래 주에도 보임(자동 이월)", () => {
    expect(show([cat("a", 1)], [per("a", "2026-09-14", null)])).toEqual(["a:active"]);
  });

  it("구간 경계: 일요일 시작·월요일 종료도 겹침으로 본다", () => {
    expect(show([cat("a", 1)], [per("a", SUN, null)])).toEqual(["a:active"]);
    expect(show([cat("a", 1)], [per("a", "2026-09-01", MON)])).toEqual(["a:ended"]);
  });

  it("다음 주에 시작하거나 지난주에 끝난 업무는 안 보임", () => {
    expect(
      show([cat("a", 1), cat("b", 2)], [per("a", "2026-10-26", null), per("b", "2026-09-01", "2026-10-18")]),
    ).toEqual([]);
  });

  it("이 주 중 종료 → ended, 주 뒤에 종료 → 그 주에선 active", () => {
    expect(show([cat("a", 1)], [per("a", "2026-09-01", "2026-10-21")])).toEqual(["a:ended"]);
    expect(show([cat("a", 1)], [per("a", "2026-09-01", "2026-11-02")])).toEqual(["a:active"]);
  });

  it("구간과 안 겹쳐도 그 주 기록이 있으면 보임(records-only)", () => {
    expect(show([cat("a", 1)], [per("a", "2026-09-01", "2026-10-01")], ["a"])).toEqual(["a:records-only"]);
  });

  it("재활성 공백 기간 주에는 안 보임", () => {
    const periods = [per("a", "2026-09-01", "2026-10-02"), per("a", "2026-11-02", null)];
    expect(show([cat("a", 1)], periods)).toEqual([]);
  });

  it("보드 순서(sort_order)대로", () => {
    const periods = [per("a", "2026-09-01", null), per("b", "2026-09-01", null)];
    expect(show([cat("a", 2), cat("b", 1)], periods)).toEqual(["b:active", "a:active"]);
  });
});

describe("종료·재활성 (data-spec 4-3)", () => {
  it("종료일 = 오늘, 미래에 시작한 구간이면 시작일", () => {
    expect(archiveEndDate(per("a", "2026-10-19", null), "2026-10-23")).toBe("2026-10-23");
    expect(archiveEndDate(per("a", "2026-11-02", null), "2026-10-23")).toBe("2026-11-02");
  });

  it("이번 주에 종료했으면 그 구간을 다시 연다", () => {
    expect(reactivatePlan([per("a", "2026-09-01", "2026-10-21", "p1")], "2026-10-19")).toEqual({
      kind: "reopen",
      periodId: "p1",
    });
  });

  it("지난 주 이전에 종료했으면 이번 주 월요일부터 새 구간", () => {
    expect(reactivatePlan([per("a", "2026-09-01", "2026-10-10")], "2026-10-19")).toEqual({
      kind: "new",
      startDate: "2026-10-19",
    });
  });
});

describe("업무 이름", () => {
  it("앞뒤 공백 제거·연속 공백 정리, 1~40자", () => {
    expect(normalizeCategoryName("  협력사   보안 점검 ")).toBe("협력사 보안 점검");
    expect(normalizeCategoryName("   ")).toBeNull();
    expect(normalizeCategoryName("가".repeat(41))).toBeNull();
    expect(normalizeCategoryName("가".repeat(40))).toHaveLength(40);
  });
});
