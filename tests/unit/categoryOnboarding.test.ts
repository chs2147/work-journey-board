// @vitest-environment node
import { describe, expect, it } from "vitest";
import { freshRepo } from "./helpers";

describe("업무·태그 온보딩 원자적 저장", () => {
  it("기존 태그·새 태그·이름이 같은 기존 태그를 중복 없이 연결", async () => {
    const { repo } = await freshRepo();
    const t = await repo.createTag("업무");
    const c = await repo.createCategory("가상 업무", "2026-W43", {
      tagIds: [t.id],
      newTags: ["새 태그", "업무", "새 태그"],
    });
    expect((await repo.listTags()).map((t) => t.name)).toEqual(["업무", "새 태그"]);
    expect((await repo.getCategoryTags())[c.id]).toHaveLength(2);
  });
  it("연결 저장 실패 시 업무·신규 태그·기간 전체 롤백", async () => {
    const { repo, db } = await freshRepo();
    await db.execute(
      "CREATE TRIGGER fail_link BEFORE INSERT ON category_tag BEGIN SELECT RAISE(ABORT,'fake failure'); END",
    );
    await expect(
      repo.createCategory("실패 업무", "2026-W43", { tagIds: [], newTags: ["남으면 안 됨"] }),
    ).rejects.toThrow("fake failure");
    expect((await repo.listCategories()).categories).toHaveLength(0);
    expect((await repo.listCategories()).periods).toHaveLength(0);
    expect(await repo.listTags()).toHaveLength(0);
  });
  it("취소 신호·삭제된 태그·중복 업무 이름이면 생성하지 않음", async () => {
    const { repo } = await freshRepo();
    const controller = new AbortController();
    controller.abort();
    await expect(
      repo.createCategory("취소", "2026-W43", {
        tagIds: [],
        newTags: ["취소 태그"],
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    await expect(
      repo.createCategory("없는 태그", "2026-W43", { tagIds: ["missing"], newTags: [] }),
    ).rejects.toThrow();
    await repo.createCategory("기존 업무", "2026-W43");
    await expect(repo.createCategory("기존 업무", "2026-W43", { tagIds: [], newTags: [] })).rejects.toThrow(
      "이미 있는",
    );
    expect((await repo.listCategories()).categories).toHaveLength(1);
    expect(await repo.listTags()).toHaveLength(0);
  });
});
