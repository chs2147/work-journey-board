import { describe, expect, it } from "vitest";
import { layoutUniverse3d } from "../../src/domain/universeLayout3d";
import type { UGraph, UNode } from "../../src/domain/universe";
const node = (id: string): UNode => ({
  id,
  ws: "sample",
  kind: "entry",
  refId: id,
  title: id,
  text: id,
  categoryId: "work",
});
describe("stable 3D world", () => {
  it("keeps existing records in place when records are added or reordered", () => {
    const g: UGraph = { nodes: [node("a"), node("b")], edges: [] };
    const before = layoutUniverse3d(g);
    const after = layoutUniverse3d({ ...g, nodes: [node("c"), node("b"), node("a")] });
    expect(after.get("a")).toEqual(before.get("a"));
    expect(after.get("b")).toEqual(before.get("b"));
    expect(before.get("a")).not.toEqual(before.get("b"));
    expect([...after.values()].every((p) => Number.isFinite(p.x + p.y + p.z))).toBe(true);
  });
});
