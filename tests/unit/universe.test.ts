import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTER,
  FOCUS_NODE_LIMIT,
  HUB_RECENT,
  buildGraph,
  connectionsOf,
  filterGraph,
  inRange,
  layoutFocus,
  layoutGalaxy,
  levelLabel,
  levelRange,
  neighborhood,
  nid,
  shiftAnchor,
  timeBuckets,
  type UniverseSnapshot,
} from "../../src/domain/universe";
import type { NoteDoc } from "../../src/domain/note";

const doc: NoteDoc = {
  v: 1,
  boxes: [
    {
      id: "b1",
      kind: "text",
      x: 0,
      y: 0,
      w: 320,
      z: 1,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "배치 재시도 흐름" }] }],
      },
      refs: [{ item: "e1" }],
    } as never,
    { id: "b2", kind: "image", x: 0, y: 0, w: 200, z: 2, asset: "a", caption: "흐름도" } as never,
  ],
  edges: [{ id: "x1", from: "b1", to: "b2", dir: "one", dash: true, label: "그림" } as never],
};

const snap = (over: Partial<UniverseSnapshot> = {}): UniverseSnapshot => ({
  ws: { key: "W", name: "회사", color: "c1" },
  categories: [
    { id: "c1", name: "정산", color: "c1", ended: false, tagIds: ["t1"] },
    { id: "c2", name: "보안", color: "c2", ended: true, tagIds: [] },
  ],
  tags: [{ id: "t1", name: "정산" }],
  entries: [
    {
      id: "e1",
      date: "2026-10-22",
      categoryId: "c1",
      depth: 0,
      seq: 1,
      text: "이관 스크립트 작성",
      flagged: true,
    },
    { id: "e2", date: "2026-10-22", categoryId: "c1", depth: 1, seq: 2, text: "재시도 3회", flagged: false },
    { id: "e3", date: "2026-10-20", categoryId: "c2", depth: 0, seq: 1, text: "점검 일정", flagged: false },
    { id: "e4", date: "2026-10-20", categoryId: "c2", depth: 0, seq: 2, text: "   ", flagged: false },
  ],
  notes: [{ weekId: "2026-W43", doc }],
  cabinet: {
    items: [{ id: "k1", kind: "folder", title: "이관 폴더", target: "D:\\x" }],
    links: [
      { itemId: "k1", categoryId: "c1", entryId: null },
      { itemId: "k1", categoryId: null, entryId: "e3" },
      { itemId: "gone", categoryId: "c1", entryId: null },
    ],
  },
  ...over,
});

describe("buildGraph — 기존 관계를 출처별로 투영(첨부 U-01·U-02)", () => {
  const g = buildGraph(snap());
  const ids = new Set(g.nodes.map((n) => n.id));
  it("노드: 공간·업무·태그·항목(빈 글 제외)·메모 상자·Cabinet", () => {
    expect(ids.has(nid("W", "workspace", "W"))).toBe(true);
    expect(ids.has(nid("W", "entry", "e4"))).toBe(false);
    expect(g.nodes.filter((n) => n.kind === "entry")).toHaveLength(3);
    expect(g.nodes.find((n) => n.refId === "b2")).toMatchObject({
      kind: "note",
      noteKind: "image",
      weekId: "2026-W43",
    });
    expect(g.nodes.find((n) => n.refId === "e1")).toMatchObject({
      flagged: true,
      color: "c1",
      weekId: "2026-W43",
    });
  });
  it("선: 본 항목 → 업무, 세부 → 바로 위 본 항목, 업무 → 태그·공간, 메모 refs·관계선(모양 보존), Cabinet 연결", () => {
    const has = (from: string, to: string, source: string) =>
      g.edges.some((e) => e.from === from && e.to === to && e.source === source);
    expect(has("W/entry/e1", "W/category/c1", "membership")).toBe(true);
    expect(has("W/entry/e2", "W/entry/e1", "membership")).toBe(true);
    expect(has("W/category/c1", "W/tag/t1", "tag")).toBe(true);
    expect(has("W/note/2026-W43/b1", "W/entry/e1", "note-ref")).toBe(true);
    const ne = g.edges.find((e) => e.source === "note-edge")!;
    expect(ne).toMatchObject({ dir: "one", dash: true, label: "그림" });
    expect(has("W/cabinet/k1", "W/category/c1", "cabinet-link")).toBe(true);
    expect(has("W/cabinet/k1", "W/entry/e3", "cabinet-link")).toBe(true);
    expect(g.edges.some((e) => e.from.includes("gone"))).toBe(false);
  });
  it("모든 선의 양 끝이 노드로 있다", () => {
    for (const e of g.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });
});

describe("필터·시간 범위", () => {
  const g = buildGraph(snap());
  it("검색(2글자 이상·낱말 모두)·종류·업무·종료 업무", () => {
    expect(
      filterGraph(g, { ...DEFAULT_FILTER, query: "재시도" })
        .nodes.map((n) => n.refId)
        .sort(),
    ).toEqual(["b1", "e2"]);
    expect(filterGraph(g, { ...DEFAULT_FILTER, query: "재" }).nodes.length).toBe(g.nodes.length);
    const onlyEntries = filterGraph(g, { ...DEFAULT_FILTER, kinds: ["entry"] });
    expect(onlyEntries.nodes.every((n) => n.kind === "entry")).toBe(true);
    expect(onlyEntries.edges.every((e) => e.source === "membership")).toBe(true);
    expect(
      filterGraph(g, { ...DEFAULT_FILTER, categoryIds: ["c2"] }).nodes.some((n) => n.refId === "e1"),
    ).toBe(false);
    expect(
      filterGraph(g, { ...DEFAULT_FILTER, includeEnded: false }).nodes.some((n) => n.refId === "c2"),
    ).toBe(false);
    expect(filterGraph(g, { ...DEFAULT_FILTER, tagIds: ["t1"] }).nodes.some((n) => n.refId === "e3")).toBe(
      false,
    );
  });
  it("범위 밖은 inRange false(날짜 없는 노드는 늘 안)", () => {
    const r = { from: "2026-10-21" as const, to: "2026-10-31" as const };
    expect(
      inRange(
        g.nodes.find((n) => n.refId === "e3")!,
        r,
      ),
    ).toBe(false);
    expect(
      inRange(
        g.nodes.find((n) => n.refId === "e1")!,
        r,
      ),
    ).toBe(true);
    expect(
      inRange(
        g.nodes.find((n) => n.refId === "t1")!,
        r,
      ),
    ).toBe(true);
  });
});

describe("초점 탐색(C안)", () => {
  it("항목 씨앗: 1·2단계 — 업무·태그(허브) 너머로는 펼치지 않음", () => {
    const g = buildGraph(snap());
    const f = neighborhood(g, "W/entry/e2")!;
    expect(f.depth.get("W/entry/e1")).toBe(1);
    expect(f.depth.get("W/category/c1")).toBe(2);
    expect(f.depth.get("W/note/2026-W43/b1")).toBe(2);
    // 업무(허브) 너머의 태그·공간·Cabinet은 오지 않는다
    expect(f.depth.has("W/tag/t1")).toBe(false);
    expect(f.depth.has("W/workspace/W")).toBe(false);
  });
  it("허브 씨앗: 최근 항목만(HUB_RECENT) + 잘림 표시, 노드 한도", () => {
    const many = Array.from({ length: HUB_RECENT + 10 }, (_, i) => ({
      id: `m${i}`,
      date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}` as const,
      categoryId: "c1",
      depth: 0 as const,
      seq: i,
      text: `기록 ${i}`,
      flagged: false,
    }));
    const g = buildGraph(snap({ entries: many }));
    const f = neighborhood(g, "W/category/c1")!;
    expect(f.nodes.filter((n) => n.kind === "entry").length).toBe(HUB_RECENT);
    expect(f.truncated).toBe(true);
    expect(f.nodes.length).toBeLessThanOrEqual(FOCUS_NODE_LIMIT);
    expect(neighborhood(g, "없음")).toBeNull();
  });
  it("연결 목록: 방향·출처", () => {
    const g = buildGraph(snap());
    const c = connectionsOf(g, "W/entry/e1");
    expect(c.map((x) => x.edge.source).sort()).toEqual(["membership", "membership", "note-ref"]);
  });
});

describe("배치 — 결정적(같은 자료 = 같은 모양)", () => {
  it("초점·은하 배치가 매번 같고 모든 노드에 자리가 있다", () => {
    const g = buildGraph(snap());
    const f = neighborhood(g, "W/entry/e1")!;
    const a = layoutFocus(f, 800, 600);
    const b = layoutFocus(f, 800, 600);
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect(a.get("W/entry/e1")).toEqual({ x: 400, y: 300 });
    for (const n of f.nodes) expect(a.has(n.id)).toBe(true);
    const ga = layoutGalaxy(g, 1000, 700);
    expect([...ga.entries()]).toEqual([...layoutGalaxy(g, 1000, 700).entries()]);
    for (const n of g.nodes) expect(ga.has(n.id)).toBe(true);
  });
});

describe("시간 막대(년→월→주→일)", () => {
  const dates = ["2026-10-20", "2026-10-22", "2026-10-22", "2026-03-05"] as const;
  it("년 = 12달, 월 = 걸친 ISO 주, 주 = 7일, 일 = 하루 + 칸별 수", () => {
    const y = timeBuckets([...dates], "year", "2026-10-22");
    expect(y).toHaveLength(12);
    expect(y[9]).toMatchObject({ label: "10월", count: 3 });
    expect(y[2]!.count).toBe(1);
    const m = timeBuckets([...dates], "month", "2026-10-22");
    expect(m[0]!.from <= "2026-10-01" && m.at(-1)!.to >= "2026-10-31").toBe(true);
    expect(m.find((b) => b.key === "2026-W43")!.count).toBe(3);
    const w = timeBuckets([...dates], "week", "2026-10-22");
    expect(w.map((b) => b.label)).toEqual(["월 19", "화 20", "수 21", "목 22", "금 23", "토 24", "일 25"]);
    expect(w[3]!.count).toBe(2);
    expect(timeBuckets([...dates], "day", "2026-10-22")[0]!.count).toBe(2);
  });
  it("이동·범위·이름", () => {
    expect(shiftAnchor("year", "2026-10-22", -1)).toBe("2025-01-01");
    expect(shiftAnchor("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftAnchor("week", "2026-10-22", 1)).toBe("2026-10-29");
    expect(levelRange("year", "2026-10-22")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(levelLabel("month", "2026-10-22")).toBe("2026년 10월");
    expect(levelLabel("week", "2026-10-22")).toBe("2026-W43");
  });
});
