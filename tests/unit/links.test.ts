// 링크(improve-1026-spec 9·10절): 글 속 주소 찾기·열 수 있는 주소·줄임·카드 제목/도메인, 메모 문서의 링크 카드·글 속 링크 정리.
import { describe, expect, it } from "vitest";
import {
  domainInitial,
  domainOf,
  domainTone,
  isOpenableUrl,
  shortUrl,
  singleUrl,
  splitLinks,
  titleFromUrl,
} from "../../src/domain/links";
import { boxText, noteAssetIds, noteToText, parseNoteDoc, sanitizeContent } from "../../src/domain/note";

describe("주소", () => {
  it("http/https만 연다 — 파일·스크립트·사용자 정보·공백·너무 긴 주소는 거부", () => {
    for (const ok of [
      "https://wiki.example.local/deploy/checklist",
      "http://intra.example.local:8080/a?b=1#c",
    ])
      expect(isOpenableUrl(ok), ok).toBe(true);
    for (const no of [
      "",
      "file:///C:/a.exe",
      "javascript:alert(1)",
      "ftp://a.example",
      "https://",
      "https://exa mple.com",
      "https://a.example/\u0007",
      `https://a.example/${"x".repeat(2100)}`,
    ])
      expect(isOpenableUrl(no), no).toBe(false);
  });

  it("글 속 주소: 문장 부호·닫는 괄호는 빼고(짝이 맞으면 포함), 조각을 이으면 원래 글", () => {
    const text = "배포 절차(https://wiki.example.local/a) 확인, 참고: https://docs.example.local/b?x=1.";
    const segs = splitLinks(text);
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.filter((s) => s.url).map((s) => s.url)).toEqual([
      "https://wiki.example.local/a",
      "https://docs.example.local/b?x=1",
    ]);
    expect(splitLinks("https://w.example.local/Foo_(bar)")[0]!.url).toBe("https://w.example.local/Foo_(bar)");
    expect(splitLinks("주소 없음")).toEqual([{ text: "주소 없음" }]);
    expect(singleUrl("  https://a.example/x \n")).toBe("https://a.example/x");
    expect(singleUrl("보세요 https://a.example/x")).toBeNull();
  });

  it("화면용 줄임·도메인·제목(경로 끝 두 마디)·첫 글자·고정 색조", () => {
    const long = "https://wiki.example.local/very/long/path/to/some/deeply/nested/page?query=1";
    const s = shortUrl(long);
    expect(s.length).toBe(48);
    expect(s).toContain("…");
    expect(shortUrl("https://a.example")).toBe("https://a.example");
    expect(domainOf("https://www.Example.local/x")).toBe("example.local");
    expect(titleFromUrl("https://wiki.example.local/deploy/checklist")).toBe("deploy/checklist");
    expect(titleFromUrl("https://wiki.example.local/%EB%B0%B0%ED%8F%AC")).toBe("배포");
    expect(titleFromUrl("https://wiki.example.local/")).toBe("wiki.example.local");
    expect(domainInitial("https://wiki.example.local")).toBe("W");
    expect(domainTone("https://a.example/x")).toBe(domainTone("https://a.example/y"));
    expect(domainTone("https://a.example")).toBeGreaterThanOrEqual(1);
  });
});

describe("메모 문서의 링크", () => {
  it("링크 카드: 주소가 열 수 없으면 버리고, 제목이 비면 주소에서, 글 = `- (링크) 제목 — 주소`, 썸네일도 이미지 목록에", () => {
    const d = parseNoteDoc(
      JSON.stringify({
        v: 1,
        boxes: [
          {
            id: "a",
            kind: "link",
            x: 3,
            y: 5,
            w: 9999,
            z: 1,
            url: "https://wiki.example.local/deploy/checklist",
            title: "",
            note: "  메모  ",
            asset: "as1",
          },
          { id: "b", kind: "link", x: 0, y: 0, w: 300, z: 1, url: "javascript:alert(1)", title: "x" },
        ],
      }),
    );
    expect(d.boxes).toHaveLength(1);
    expect(d.boxes[0]).toMatchObject({
      x: 0,
      y: 8,
      w: 640,
      title: "deploy/checklist",
      note: "메모",
      asset: "as1",
    });
    expect(boxText(d.boxes[0]!)).toBe(
      "- (링크) deploy/checklist — https://wiki.example.local/deploy/checklist",
    );
    expect(noteToText(d)).toBe("- (링크) deploy/checklist — https://wiki.example.local/deploy/checklist");
    expect(noteAssetIds(d)).toEqual(["as1"]);
  });

  it("글 상자 속 링크 서식: http/https 주소만 남기고 다른 속성은 버린다", () => {
    const doc = sanitizeContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "위키",
              marks: [
                { type: "link", attrs: { href: "https://w.example.local", target: "_blank", onclick: "x" } },
              ],
            },
            { type: "text", text: "나쁜", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
          ],
        },
      ],
    });
    expect(doc!.content![0]!.content).toEqual([
      { type: "text", text: "위키", marks: [{ type: "link", attrs: { href: "https://w.example.local" } }] },
      { type: "text", text: "나쁜" },
    ]);
  });
});
