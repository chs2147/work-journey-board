// @vitest-environment node
// 업무 태그·태그 필터(improve-1026-spec 4~6절): 이름 정리·검증, OR 필터·태그 없음, 칩 줄이기, 저장소 CRUD·연결.
import { describe, expect, it } from "vitest";
import {
  chipsToShow,
  filterLabel,
  matchesTagFilter,
  NO_TAG,
  normalizeTagName,
  tagNameProblem,
  type Tag,
} from "../../src/domain/tags";
import { ValidationError } from "../../src/data/repository";
import { DEFAULT_SETTINGS, mergeSettings } from "../../src/data/settings";
import { freshRepo } from "./helpers";

describe("태그 도메인", () => {
  it("이름: 앞의 #·앞뒤 공백을 떼고 안쪽 공백은 하나로, 1~20자, 대소문자 무시 중복 금지", () => {
    expect(normalizeTagName("  ## 프로젝트   A ")).toBe("프로젝트 A");
    expect(tagNameProblem("", [])).not.toBeNull();
    expect(tagNameProblem("가".repeat(21), [])).not.toBeNull();
    expect(tagNameProblem("Dev", ["dev"])).toContain("이미 있는 태그");
    expect(tagNameProblem("개발", ["dev"])).toBeNull();
  });

  it("필터: 고른 태그가 하나라도(OR), 태그 없음은 NO_TAG, 고른 게 없으면 모두", () => {
    expect(matchesTagFilter(["a"], [])).toBe(true);
    expect(matchesTagFilter([], [])).toBe(true);
    expect(matchesTagFilter(["a", "b"], ["b", "c"])).toBe(true);
    expect(matchesTagFilter(["a"], ["c"])).toBe(false);
    expect(matchesTagFilter([], ["c"])).toBe(false);
    expect(matchesTagFilter([], ["c", NO_TAG])).toBe(true);
    expect(matchesTagFilter(["a"], [NO_TAG])).toBe(false);
  });

  it("칩은 3개 + 나머지 수, 필터 글은 `#A` / `#A 외 1`(없어진 태그는 뺌)", () => {
    expect(chipsToShow([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3], more: 2 });
    expect(chipsToShow([1])).toEqual({ shown: [1], more: 0 });
    const tags: Tag[] = [
      { id: "a", name: "프로젝트A", sortOrder: 1 },
      { id: "b", name: "개발", sortOrder: 2 },
    ];
    expect(filterLabel(["a"], tags, "태그 없음")).toBe("#프로젝트A");
    expect(filterLabel(["a", NO_TAG, "gone"], tags, "태그 없음")).toBe("#프로젝트A 외 1");
    expect(filterLabel(["gone"], tags, "태그 없음")).toBe("");
  });

  it("설정 ui.tagFilter: 기본 빈 배열, 문자열 배열이 아니면 버림", () => {
    expect(DEFAULT_SETTINGS.ui.tagFilter).toEqual([]);
    expect(mergeSettings(DEFAULT_SETTINGS, { ui: { tagFilter: ["a", NO_TAG] } }).ui.tagFilter).toEqual([
      "a",
      NO_TAG,
    ]);
    expect(mergeSettings(DEFAULT_SETTINGS, { ui: { tagFilter: "a" } }).ui.tagFilter).toEqual([]);
    expect(mergeSettings(DEFAULT_SETTINGS, { ui: { tagFilter: [1] } }).ui.tagFilter).toEqual([]);
  });
});

describe("저장소: 태그", () => {
  it("만들기(끝 순서)·이름 검증·바꾸기·순서·붙이기/떼기·지우면 업무에서도 떨어짐", async () => {
    const { repo } = await freshRepo();
    const c1 = await repo.createCategory("가상 업무 1", "2026-W43");
    const c2 = await repo.createCategory("가상 업무 2", "2026-W43");
    const a = await repo.createTag("#프로젝트A");
    const b = await repo.createTag("개발");
    expect(a.name).toBe("프로젝트A");
    expect((await repo.listTags()).map((t) => [t.name, t.sortOrder])).toEqual([
      ["프로젝트A", 1],
      ["개발", 2],
    ]);
    await expect(repo.createTag("프로젝트a")).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.createTag("  ")).rejects.toBeInstanceOf(ValidationError);

    await repo.setCategoryTag(c1.id, b.id, true);
    await repo.setCategoryTag(c1.id, a.id, true);
    await repo.setCategoryTag(c1.id, a.id, true); // 두 번 붙여도 하나
    await repo.setCategoryTag(c2.id, b.id, true);
    expect(await repo.getCategoryTags()).toEqual({ [c1.id]: [a.id, b.id], [c2.id]: [b.id] }); // 태그 순서대로

    await repo.reorderTags([b.id, a.id]);
    expect((await repo.getCategoryTags())[c1.id]).toEqual([b.id, a.id]);
    await repo.renameTag(a.id, "프로젝트 A");
    await expect(repo.renameTag(a.id, "개발")).rejects.toBeInstanceOf(ValidationError);
    await repo.renameTag(a.id, "프로젝트 A"); // 자기 이름 그대로는 괜찮다

    await repo.setCategoryTag(c2.id, b.id, false);
    await repo.deleteTag(b.id);
    expect(await repo.listTags()).toEqual([{ id: a.id, name: "프로젝트 A", sortOrder: 2 }]);
    expect(await repo.getCategoryTags()).toEqual({ [c1.id]: [a.id] });
  });

  it("업무를 지우면 태그 연결도 사라지고 태그는 남는다", async () => {
    const { repo } = await freshRepo();
    const c = await repo.createCategory("가상 업무", "2026-W43");
    const t = await repo.createTag("회의");
    await repo.setCategoryTag(c.id, t.id, true);
    expect(await repo.deleteCategoryIfEmpty(c.id)).toBe(true);
    expect(await repo.getCategoryTags()).toEqual({});
    expect(await repo.listTags()).toHaveLength(1);
  });
});
