// 검색(features-1102-spec F1): 낱말 AND·부분 일치, 메모 글 뽑기, 저장소 조회(업무 기록 + 메모), 정렬·형광 위치.
import { describe, expect, it } from "vitest";
import showcase from "../../fixtures/sample-showcase.json";
import { seedSample, type SampleData } from "../../src/data/seed";
import type { NoteDoc } from "../../src/domain/note";
import {
  highlightRanges,
  matchesAll,
  searchNote,
  searchTerms,
  snippet,
  sortHits,
} from "../../src/domain/search";
import { freshRepo } from "./helpers";

const doc = (showcase as unknown as SampleData).weekNotes![0]!.doc as NoteDoc;

describe("domain/search", () => {
  it("낱말: 2글자 미만은 찾지 않음, 띄어쓰기로 나누고 소문자·중복 제거", () => {
    expect(searchTerms(" 배 ")).toEqual([]);
    expect(searchTerms("배치  Wiki 배치")).toEqual(["배치", "wiki"]);
    expect(matchesAll("정산 배치 설계서 (WIKI)", ["배치", "wiki"])).toBe(true);
    expect(matchesAll("정산 배치", ["배치", "wiki"])).toBe(false);
  });

  it("형광 위치는 겹치면 합치고, 긴 줄은 첫 일치 근처로 줄인다", () => {
    expect(highlightRanges("배치 배치스케줄러", ["배치", "치스"])).toEqual([
      [0, 2],
      [3, 6],
    ]);
    const long = `${"가".repeat(200)} 배치 ${"나".repeat(200)}`;
    const s = snippet(long, ["배치"]);
    expect(s.startsWith("…")).toBe(true);
    expect(s).toContain("배치");
    expect(s.length).toBeLessThanOrEqual(122);
  });

  it("메모: 글 상자(첫 일치 줄)·이미지 설명·링크 카드·관계선 이름표, 연결 항목 id", () => {
    const hits = searchNote("2026-W43", doc, ["배치"]);
    expect(hits.map((h) => [h.kind, h.text])).toEqual([
      ["text", "야간 배치 02~04시 확정"],
      ["image", "정산 배치 흐름 v2(리뷰 반영)"],
      ["link", "정산 배치 설계서 v2(사내 위키)"],
    ]);
    expect(hits[0]!.linkedItemId).toBe("it-sched");
    expect(searchNote("2026-W43", doc, ["후속"]).map((h) => [h.kind, h.boxId])).toEqual([
      ["edge", "box-acct"],
    ]);
    expect(searchNote("2026-W43", doc, ["meeting-1020"])).toEqual([]); // 글 상자의 링크 주소는 글이 아님
    expect(searchNote("2026-W43", doc, ["wiki.example.com/settlement/batch"]).map((h) => h.kind)).toEqual([
      "link",
    ]);
  });

  it("정렬: 최근 주 먼저, 같은 주는 업무 기록(날짜순) → 메모", () => {
    const h = (weekId: string, area: "item" | "memo", date?: string) =>
      ({ key: `${weekId}${area}${date}`, area, kind: "item", weekId, date, text: "" }) as never;
    const out = sortHits([
      h("2026-W42", "item", "2026-10-13"),
      h("2026-W43", "memo"),
      h("2026-W43", "item", "2026-10-21"),
      h("2026-W43", "item", "2026-10-19"),
    ]);
    expect(out.map((x: { key: string }) => x.key)).toEqual([
      "2026-W43item2026-10-19",
      "2026-W43item2026-10-21",
      "2026-W43memoundefined",
      "2026-W42item2026-10-13",
    ]);
  });
});

describe("repository.search", () => {
  it("업무 기록(본·세부)과 메모를 함께, 기간·특수 문자·건수", async () => {
    const { db, repo } = await freshRepo();
    await seedSample(db, showcase as unknown as SampleData);
    const { hits } = await repo.search("배치");
    const items = hits.filter((x) => x.area === "item");
    const memos = hits.filter((x) => x.area === "memo");
    expect(memos.map((m) => m.kind)).toEqual(["text", "image", "link"]);
    expect(items.find((x) => x.text === "야간 배치 시간대 02~04시로 협의")).toMatchObject({
      kind: "subitem",
      date: "2026-10-20",
      categoryName: "차세대 정산 시스템 구축",
      weekId: "2026-W43",
    });
    // 최근 주 먼저 — W43 결과가 W42보다 앞
    const weeks = hits.map((x) => x.weekId);
    expect(weeks.indexOf("2026-W42")).toBeGreaterThan(weeks.lastIndexOf("2026-W43"));
    // 기간: 10/19부터면 W42 업무 기록은 빠짐
    const recent = await repo.search("배치", "2026-10-19");
    expect(recent.hits.every((x) => x.weekId === "2026-W43")).toBe(true);
    // LIKE 특수 문자는 글자 그대로
    expect((await repo.search("100%")).hits).toEqual([]);
    // 낱말이 한 상자 안 여러 줄에 흩어져 있어도 맞음(글 상자 전체 글)
    expect((await repo.search("02~04시 협의")).hits.map((x) => [x.area, x.text])).toEqual([
      ["item", "야간 배치 시간대 02~04시로 협의"],
      [
        "memo",
        "야간 배치 02~04시 확정 운영팀 공유 완료 재처리 조건은 수요일 리뷰에서 회의록: 10/20 배치 협의",
      ],
    ]);
    expect((await repo.search("배")).hits).toEqual([]);
  });
});
