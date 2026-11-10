// 개선 v20(improve-v20-spec): 업무노트 삭제 잠금·복제(자산 새 id)·마이그레이션 v18 → v19
import { describe, expect, it, vi } from "vitest";
import { freshRepo } from "./helpers";
import { CabiLockedError, cabiAssetIds, copyTitle, remapAssets } from "../../src/domain/cabi";
import { migrate, MIGRATIONS, quickCheck } from "../../src/data/migrate";
import { openSqlJsMemory } from "../../src/data/drivers/sqlJs";

const image = { mime: "image/png" as const, data: "AAAA", width: 10, height: 10, bytes: 3 };
const withImage = (asset: string) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "가상 절차" }] },
    { type: "image", attrs: { asset } },
  ],
});

describe("복제 제목·자산 다시 매기기(순수)", () => {
  it("(사본) → (사본 2) …, 200자 제한 안", () => {
    expect(copyTitle("가상 노트", new Set())).toBe("가상 노트 (사본)");
    expect(copyTitle("가상 노트", new Set(["가상 노트 (사본)"]))).toBe("가상 노트 (사본 2)");
    expect(copyTitle("가".repeat(300), new Set()).length).toBeLessThanOrEqual(200);
    expect(copyTitle("가".repeat(300), new Set()).endsWith(" (사본)")).toBe(true);
  });
  it("이미지 자산 id만 바꾸고 원본은 그대로", () => {
    const src = withImage("a1");
    const out = remapAssets(src, new Map([["a1", "b1"]]));
    expect(cabiAssetIds(out)).toEqual(["b1"]);
    expect(cabiAssetIds(src)).toEqual(["a1"]);
  });
});

describe("업무노트 삭제 잠금·복제(저장소)", () => {
  it("새 노트는 잠금 꺼짐 → 잠그면 삭제 거부(편집은 됨) → 풀면 삭제", async () => {
    const { repo, db } = await freshRepo();
    const c = await repo.createCategory("가상 업무", "2026-W43");
    let n = await repo.cabi.createNote(c.id, "가상 노트");
    expect(n.deleteLocked).toBe(false);
    n = await repo.cabi.setNoteDeleteLock(n.id, true);
    expect(n.deleteLocked).toBe(true);
    expect((await repo.cabi.listNotes(c.id))[0]!.deleteLocked).toBe(true);
    // 잠금은 revision을 올리지 않는다(열린 편집 창과 충돌하지 않게)
    expect(n.revision).toBe(1);
    n = await repo.cabi.saveNote(n.id, n.revision, "가상 노트 고침", n.content);
    await expect(repo.cabi.removeNote(n.id, n.revision)).rejects.toBeInstanceOf(CabiLockedError);
    expect((await repo.cabi.listNotes(c.id)).length).toBe(1);
    n = await repo.cabi.setNoteDeleteLock(n.id, false);
    await repo.cabi.removeNote(n.id, n.revision);
    expect(await repo.cabi.listNotes(c.id)).toEqual([]);
    await db.close();
  });
  it("복제: 같은 업무·(사본) 제목·본문 그대로, 이미지는 새 id로 복사, 잠금은 옮기지 않음, 원본 지워도 사본 이미지 남음", async () => {
    const { repo, db } = await freshRepo();
    const c = await repo.createCategory("가상 업무", "2026-W43");
    let src = await repo.cabi.createNote(c.id, "가상 절차");
    const a = await repo.cabi.addAsset("note", src.id, image);
    src = await repo.cabi.saveNote(src.id, src.revision, src.title, withImage(a));
    src = await repo.cabi.setNoteDeleteLock(src.id, true);
    const copy = await repo.cabi.duplicateNote(src.id);
    expect(copy.id).not.toBe(src.id);
    expect(copy.categoryId).toBe(c.id);
    expect(copy.title).toBe("가상 절차 (사본)");
    expect(copy.deleteLocked).toBe(false);
    const [copied] = cabiAssetIds(copy.content);
    expect(copied).toBeTruthy();
    expect(copied).not.toBe(a);
    expect(await repo.cabi.asset(copied!)).not.toBeNull();
    // 두 번째 복제는 (사본 2)
    expect((await repo.cabi.duplicateNote(src.id)).title).toBe("가상 절차 (사본 2)");
    // 원본 삭제 → 원본 이미지만 사라지고 사본 이미지는 남는다
    src = await repo.cabi.setNoteDeleteLock(src.id, false);
    await repo.cabi.removeNote(src.id, src.revision);
    expect(await repo.cabi.asset(a)).toBeNull();
    expect(await repo.cabi.asset(copied!)).not.toBeNull();
    await db.close();
  });
});

describe("마이그레이션 v18 → v19(delete_locked)", () => {
  it("직전 백업, 기존 노트는 잠금 꺼짐, 0/1만 저장", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.slice(0, 18) });
    await db.execute(
      "INSERT INTO category (id, name, color, sort_order, created_at, updated_at) VALUES ('c1', '업무', 'c1', 1, 't', 't')",
    );
    await db.execute(
      "INSERT INTO cabi_note (id, category_id, title, content, created_at, updated_at) VALUES ('n1', 'c1', '가상', '{}', 't', 't')",
    );
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { beforeMigrate: before, migrations: MIGRATIONS.slice(0, 19) })).toBe(19);
    expect(before).toHaveBeenCalledWith(18, 19);
    expect(await db.select("SELECT delete_locked FROM cabi_note")).toEqual([{ delete_locked: 0 }]);
    await db.execute("UPDATE cabi_note SET delete_locked = 1");
    await expect(db.execute("UPDATE cabi_note SET delete_locked = 2")).rejects.toThrow();
    expect(await quickCheck(db)).toBe(true);
  });
});
