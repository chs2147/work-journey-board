// @vitest-environment node
// UX-5 "새로 시작하기"(docs/v2-design/95 U4): 메모리의 빈 일지 → 이관 자료. 업무 없음, 이름·색·아이콘만, 같은 작업 ID면 같은 공간 ID
import { describe, expect, it } from "vitest";
import { labelOf, prepareEmpty, summarize } from "../../src/preview/migrationSession";

describe("새로 시작하기 — 빈 온라인 공간 자료", () => {
  it("업무·기록·그림 없이 지금 구조, 설정에 이름·색·아이콘", async () => {
    const meta = { name: "가상 새 공간", color: "c3", icon: "bulb" };
    const copy = await prepareEmpty(
      "11111111-1111-4111-8111-111111111111",
      meta,
      () => new Date(2026, 10, 16),
    );
    const s = summarize(copy);
    expect(s.entries).toBe(0);
    expect(s.categories).toBe(0);
    expect(s.images).toBe(0);
    expect(s.sourceSchema).toBeGreaterThanOrEqual(20);
    expect(labelOf(copy)).toEqual(meta);
    // 그림 본문·data URL 없음(온라인 DB 이미지 이중 저장 금지 — 빈 공간이라도 같은 규칙)
    expect(JSON.stringify(copy.pages)).not.toMatch(/data:image\//);
    const again = await prepareEmpty(
      "11111111-1111-4111-8111-111111111111",
      meta,
      () => new Date(2026, 10, 16),
    );
    expect(again.workspaceId).toBe(copy.workspaceId);
  });
});
