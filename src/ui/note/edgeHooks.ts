// 관계선 화면 조각들이 함께 쓰는 계산(note-relation-spec): 선 경로·키보드 후보·상자의 선 수.
import { useMemo } from "react";
import { boxEdges, edgesOf, type NoteBox, type NoteDoc, type NoteEdge } from "../../domain/note";
import { nearestBoxes, rectOf, routeEdge, type EdgeRoute } from "../../domain/noteEdge";
import { useNote } from "./noteStore";

/** 선마다 경로(겹친 상자는 그리지 않음) */
export function useEdgeRoutes(doc: NoteDoc) {
  return useMemo(() => {
    const byId = new Map(doc.boxes.map((b) => [b.id, b]));
    const out: { edge: NoteEdge; route: EdgeRoute; from: NoteBox; to: NoteBox }[] = [];
    for (const edge of edgesOf(doc)) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) continue;
      const route = routeEdge(rectOf(from), rectOf(to));
      if (route) out.push({ edge, route, from, to });
    }
    return out;
  }, [doc]);
}

/** 키보드로 잇기의 후보(가까운 순 9개, 대기 상자 빼고) */
export function linkCandidates(doc: NoteDoc, from: string, pendingId: string | null): NoteBox[] {
  const src = doc.boxes.find((b) => b.id === from);
  if (!src) return [];
  return nearestBoxes(
    src,
    doc.boxes.filter((b) => b.id !== pendingId),
  ).slice(0, 9);
}

/** 이 상자의 관계선 수(상자 aria-label에 덧붙임) */
export const useEdgeCount = (boxId: string) => useNote((s) => boxEdges(s.doc, boxId).length);
