// Universe UV2 직접 연결(universe-spec 5-1·8-1): 도메인 규칙 · 그래프 선 · 저장소(만들기·고치기·끊기·되살리기) · 마이그레이션 v10 → v11
import { describe, expect, it, vi } from "vitest";
import { openSqlJsMemory } from "../../src/data/drivers/sqlJs";
import { MIGRATIONS, migrate, quickCheck } from "../../src/data/migrate";
import { RelationError } from "../../src/data/repository";
import {
  buildGraph,
  endOf,
  neighborhood,
  nid,
  relationProblem,
  type URelation,
  type UniverseSnapshot,
} from "../../src/domain/universe";
import { freshRepo } from "./helpers";

const e = (id: string) => ({ kind: "entry" as const, id });
const rel = (id: string, from: string, to: string, type: URelation["type"] = "related"): URelation => ({
  id,
  from: e(from),
  to: e(to),
  type,
  note: "",
});

describe("relationProblem — 자기 연결·중복(관련은 방향 없음) 금지", () => {
  const list = [rel("r1", "a", "b", "follow-up"), rel("r2", "a", "c", "related")];
  it("자기 자신·없는 종류·긴 설명", () => {
    expect(relationProblem([], { from: e("a"), to: e("a"), type: "related", note: "" })).toBe("self");
    expect(relationProblem([], { from: e("a"), to: e("b"), type: "x" as never, note: "" })).toBe("type");
    expect(
      relationProblem([], {
        from: { kind: "workspace" as never, id: "w" },
        to: e("b"),
        type: "related",
        note: "",
      }),
    ).toBe("kind");
    expect(relationProblem([], { from: e("a"), to: e("b"), type: "related", note: "가".repeat(201) })).toBe(
      "note",
    );
    expect(relationProblem([], { from: e("a"), to: e("b"), type: "related", note: "가".repeat(200) })).toBe(
      null,
    );
  });
  it("방향 있는 종류는 같은 방향만 중복, 반대 방향·다른 종류는 허용", () => {
    expect(relationProblem(list, { from: e("a"), to: e("b"), type: "follow-up", note: "" })).toBe(
      "duplicate",
    );
    expect(relationProblem(list, { from: e("b"), to: e("a"), type: "follow-up", note: "" })).toBe(null);
    expect(relationProblem(list, { from: e("a"), to: e("b"), type: "supports", note: "" })).toBe(null);
  });
  it("관련은 방향이 없어 반대로 이어도 중복 · 고치는 자기 자신은 빼고 본다", () => {
    expect(relationProblem(list, { from: e("c"), to: e("a"), type: "related", note: "" })).toBe("duplicate");
    expect(relationProblem(list, { from: e("a"), to: e("c"), type: "related", note: "고침" }, "r2")).toBe(
      null,
    );
  });
  it("메모 상자 끝은 주까지 같아야 같은 끝", () => {
    const n1 = { kind: "note" as const, id: "b1", week: "2026-W43" as const };
    const n2 = { kind: "note" as const, id: "b1", week: "2026-W44" as const };
    expect(relationProblem([], { from: n1, to: n2, type: "related", note: "" })).toBe(null);
    expect(relationProblem([], { from: n1, to: { ...n1 }, type: "related", note: "" })).toBe("self");
  });
});

const snap = (relations: URelation[]): UniverseSnapshot => ({
  ws: { key: "W", name: "회사", color: "c1" },
  categories: [{ id: "c1", name: "정산", color: "c1", ended: false, tagIds: [] }],
  tags: [],
  entries: [
    ...Array.from({ length: 40 }, (_, i) => ({
      id: `n${i}`,
      date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}` as `${number}-${number}-${number}`,
      categoryId: "c1",
      depth: 0 as const,
      seq: i + 1,
      text: `가까운 기록 ${i}`,
      flagged: false,
    })),
    {
      id: "old",
      date: "2025-01-02",
      categoryId: "c1",
      depth: 0,
      seq: 1,
      text: "오래전 기록",
      flagged: false,
    },
    {
      id: "seed",
      date: "2026-10-22",
      categoryId: "c1",
      depth: 0,
      seq: 99,
      text: "오늘 기록",
      flagged: false,
    },
  ],
  notes: [],
  cabinet: { items: [], links: [] },
  relations,
});

describe("buildGraph·neighborhood — 직접 연결 선", () => {
  it("두 끝이 있으면 굵은 선(방향·설명), 한쪽이 지워졌으면 그리지 않음", () => {
    const g = buildGraph(
      snap([
        { ...rel("r1", "seed", "old", "supersedes"), note: "새 방식" },
        rel("r2", "seed", "gone", "related"),
      ]),
    );
    const rs = g.edges.filter((x) => x.source === "relation");
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({
      from: nid("W", "entry", "seed"),
      to: nid("W", "entry", "old"),
      dir: "one",
      label: "새 방식",
      rel: { id: "r1", type: "supersedes", note: "새 방식" },
    });
  });
  it("초점 보기: 날짜가 먼 끝도 직접 연결이면 늘 함께(업무 허브의 가까운 기록 한도와 무관)", () => {
    const g = buildGraph(snap([rel("r1", "seed", "old", "follow-up")]));
    const f = neighborhood(g, nid("W", "entry", "seed"))!;
    expect(f.nodes.some((n) => n.id === nid("W", "entry", "old"))).toBe(true);
    const plain = neighborhood(buildGraph(snap([])), nid("W", "entry", "seed"))!;
    expect(plain.nodes.some((n) => n.id === nid("W", "entry", "old"))).toBe(false);
  });
  it("endOf: 공간 노드는 끝이 될 수 없고, 메모 상자는 주를 함께", () => {
    const g = buildGraph(snap([]));
    expect(endOf(g.nodes.find((n) => n.kind === "workspace")!)).toBe(null);
    expect(
      endOf({ id: "x", ws: "W", kind: "note", refId: "b1", title: "", text: "", weekId: "2026-W43" }),
    ).toEqual({ kind: "note", id: "b1", week: "2026-W43" });
  });
});

describe("저장소 — 직접 연결 만들기·고치기·끊기·되살리기(같은 일지 안, 소프트 삭제)", () => {
  async function setup() {
    const { repo, db } = await freshRepo();
    const c = await repo.createCategory("정산", "2026-W43");
    const [a, b] = await repo.saveCell("2026-10-22", c.id, [
      { id: "ea", depth: 0, text: "이관 스크립트" },
      { id: "eb", depth: 0, text: "재시도 3회" },
    ]);
    return { repo, db, c, a: a!, b: b! };
  }
  it("만들면 스냅샷 선으로, 같은 연결 두 번·자기 연결·없는 끝은 거부", async () => {
    const { repo, a, b, c } = await setup();
    const r = await repo.addRelation({ from: e(a.id), to: e(b.id), type: "follow-up", note: "  이어짐  " });
    expect(r.note).toBe("이어짐");
    await expect(
      repo.addRelation({ from: e(a.id), to: e(b.id), type: "follow-up", note: "" }),
    ).rejects.toMatchObject({ problem: "duplicate" });
    await expect(
      repo.addRelation({ from: e(a.id), to: e(a.id), type: "related", note: "" }),
    ).rejects.toBeInstanceOf(RelationError);
    await expect(
      repo.addRelation({ from: e(a.id), to: e("없는-항목"), type: "related", note: "" }),
    ).rejects.toMatchObject({ problem: "missing" });
    // 업무 ↔ 항목도 끝이 될 수 있다
    await repo.addRelation({ from: { kind: "category", id: c.id }, to: e(b.id), type: "supports", note: "" });
    const snapshot = await repo.getUniverseSnapshot({ key: "W", name: "회사", color: "c1" });
    expect(snapshot.relations).toHaveLength(2);
    expect(buildGraph(snapshot).edges.filter((x) => x.source === "relation")).toHaveLength(2);
  });
  it("메모 상자 끝: 그 주 문서에 상자가 있어야 저장", async () => {
    const { repo, a } = await setup();
    await repo.saveWeekNote("2026-W43", {
      v: 1,
      boxes: [
        {
          id: "bx",
          kind: "text",
          x: 0,
          y: 0,
          w: 200,
          z: 1,
          content: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "가상 메모" }] }],
          },
        } as never,
      ],
    });
    await repo.addRelation({
      from: e(a.id),
      to: { kind: "note", id: "bx", week: "2026-W43" },
      type: "supports",
      note: "",
    });
    await expect(
      repo.addRelation({
        from: e(a.id),
        to: { kind: "note", id: "bx", week: "2026-W44" },
        type: "supports",
        note: "",
      }),
    ).rejects.toMatchObject({ problem: "missing" });
  });
  it("고치기(종류·설명·방향) → 이전 값 반환, 끊기는 행을 남기고 목록에서만 빠짐 → 되살리기", async () => {
    const { repo, db, a, b } = await setup();
    const r = await repo.addRelation({ from: e(a.id), to: e(b.id), type: "follow-up", note: "처음" });
    const before = await repo.updateRelation(r.id, { type: "supersedes", note: "고침", swap: true });
    expect(before).toMatchObject({ type: "follow-up", note: "처음", from: e(a.id) });
    expect((await repo.listRelations())[0]).toMatchObject({
      type: "supersedes",
      note: "고침",
      from: e(b.id),
      to: e(a.id),
    });
    await repo.deleteRelation(r.id);
    expect(await repo.listRelations()).toEqual([]);
    expect(await db.select("SELECT id FROM universe_relation")).toEqual([{ id: r.id }]); // 소프트 삭제
    expect(await repo.restoreRelation(r.id)).toBe(true);
    expect(await repo.listRelations()).toHaveLength(1);
    expect(await repo.restoreRelation(r.id)).toBe(false); // 이미 살아 있음
  });
  it("끊은 뒤 같은 연결을 다시 만들었으면 되살리지 않는다(중복 방지)", async () => {
    const { repo, a, b } = await setup();
    const r = await repo.addRelation({ from: e(a.id), to: e(b.id), type: "related", note: "" });
    await repo.deleteRelation(r.id);
    await repo.addRelation({ from: e(b.id), to: e(a.id), type: "related", note: "" });
    expect(await repo.restoreRelation(r.id)).toBe(false);
    expect(await repo.listRelations()).toHaveLength(1);
  });
  it("원본 항목을 지워도 연결 행은 남고 그래프에는 그리지 않는다", async () => {
    const { repo, a, b, c } = await setup();
    await repo.addRelation({ from: e(a.id), to: e(b.id), type: "related", note: "" });
    await repo.saveCell("2026-10-22", c.id, [{ id: a.id, depth: 0, text: "이관 스크립트" }]);
    const s = await repo.getUniverseSnapshot({ key: "W", name: "회사", color: "c1" });
    expect(s.relations).toHaveLength(1);
    expect(buildGraph(s).edges.filter((x) => x.source === "relation")).toHaveLength(0);
  });
});

describe("마이그레이션 v10 → v11(universe_relation)", () => {
  it("직전 백업, 기존 자료 그대로, 종류·자기 연결·설명 길이 검사", async () => {
    const db = await openSqlJsMemory();
    await migrate(db, { migrations: MIGRATIONS.slice(0, 10) });
    await db.execute(
      "INSERT INTO category (id, name, color, sort_order, created_at, updated_at) VALUES ('c1', '업무', 'c1', 1, 't', 't')",
    );
    const before = vi.fn().mockResolvedValue(undefined);
    expect(await migrate(db, { beforeMigrate: before })).toBe(11);
    expect(before).toHaveBeenCalledWith(10, 11);
    expect(await db.select("SELECT id FROM category")).toEqual([{ id: "c1" }]);
    const ins = (vals: string) =>
      db.execute(
        `INSERT INTO universe_relation (id, from_kind, from_id, from_week, to_kind, to_id, to_week, relation_type, note, created_at, updated_at) VALUES ${vals}`,
      );
    await ins("('r1', 'entry', 'a', NULL, 'note', 'b', '2026-W43', 'supports', '', 't', 't')");
    await expect(
      ins("('r2', 'workspace', 'a', NULL, 'entry', 'b', NULL, 'related', '', 't', 't')"),
    ).rejects.toThrow();
    await expect(
      ins("('r3', 'entry', 'a', NULL, 'entry', 'b', NULL, 'likes', '', 't', 't')"),
    ).rejects.toThrow();
    await expect(
      ins("('r4', 'entry', 'a', NULL, 'entry', 'a', NULL, 'related', '', 't', 't')"),
    ).rejects.toThrow();
    await expect(
      ins(`('r5', 'entry', 'a', NULL, 'entry', 'b', NULL, 'related', '${"가".repeat(201)}', 't', 't')`),
    ).rejects.toThrow();
    expect(await quickCheck(db)).toBe(true);
  });
});
