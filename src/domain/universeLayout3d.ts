import { hash01, type UGraph } from "./universe";
export type Point3 = { x: number; y: number; z: number };
/** Stable world coordinates: adding records never moves existing nodes. */
export function layoutUniverse3d(graph: UGraph): Map<string, Point3> {
  const points = new Map<string, Point3>();
  const center = (key: string, radius: number): Point3 => {
    const a = hash01(key + "/angle") * Math.PI * 2;
    return {
      x: Math.cos(a) * radius,
      y: Math.sin(a) * radius * 0.65,
      z: (hash01(key + "/depth") - 0.5) * radius,
    };
  };
  for (const n of graph.nodes) {
    const ws = center(n.ws, 240);
    const group = center(n.ws + "/" + (n.categoryId ?? n.kind), 150);
    const local = center(n.id, n.kind === "category" ? 0 : 25 + hash01(n.id) * 90);
    points.set(
      n.id,
      n.kind === "workspace"
        ? ws
        : { x: ws.x + group.x + local.x, y: ws.y + group.y + local.y, z: ws.z + group.z + local.z },
    );
  }
  return points;
}
