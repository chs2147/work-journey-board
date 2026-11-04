// @vitest-environment node
import { describe, expect, it } from "vitest";
import { markdownToNote } from "../../src/domain/markdownNote";
import { sanitizeContent, type PMNode } from "../../src/domain/note";

const links = (node: PMNode): string[] => [
  ...(node.marks ?? []).flatMap((m) => (m.type === "link" ? [String(m.attrs?.href)] : [])),
  ...(node.content ?? []).flatMap(links),
];
describe("Markdown 텍스트 메모", () => {
  it("제목·목록·강조·인용·코드·표의 글은 남기고 서식은 일반 문단으로", () => {
    const out = markdownToNote(
      "\uFEFF---\nprivate: meta\n---\n# 제목\n\n- **한글** _강조_\n\n> 인용\n\n```ts\nconst a = 1;\n```\n\n|열1|열2|\n|---|---|\n|가|나|",
    );
    expect(out.text).toContain("제목");
    expect(out.text).toContain("한글 강조");
    expect(out.text).toContain("const a = 1;");
    expect(out.text).toContain("가\t나");
    expect(out.text).not.toContain("private");
    expect(out.content.content?.every((n) => n.type === "paragraph")).toBe(true);
    expect(sanitizeContent(out.content)).toEqual(out.content);
  });
  it("링크 제목·단독 URL·참조형 링크를 기존 link mark로 남긴다", () => {
    const out = markdownToNote(
      "[프로젝트 문서](https://example.com/docs)\n\nhttps://example.com/guide.\n\n[참조][ref]\n\n[ref]: https://example.com/ref",
    );
    expect(out.text).toContain("프로젝트 문서");
    expect(out.text).not.toContain("(https://example.com/docs)");
    expect(links(out.content)).toEqual([
      "https://example.com/docs",
      "https://example.com/guide",
      "https://example.com/ref",
    ]);
    expect(sanitizeContent(out.content)).toEqual(out.content);
  });
  it("data URI 이미지·참조형 첨부·HTML 이미지 제외, 대체 글은 보존", () => {
    const data = "Aa1+/".repeat(100);
    const out = markdownToNote(
      `앞\n\n![대체](data:image/png;base64,${data})\n\n![참조][img]\n\n[img]: data:image/png;base64,${data}\n\n<img alt="그림 설명" src="data:image/png;base64,${data}">\n\n뒤`,
    );
    expect(out.excluded).toBe(true);
    expect(out.text).not.toContain("base64");
    expect(out.text).not.toContain(data);
    expect(out.text).toContain("대체");
    expect(out.text).toContain("참조");
    expect(out.text).toContain("그림 설명");
    expect(out.text).toContain("뒤");
  });
  it("다중행 base64와 코드 블록 첨부를 빼되 일반 식별자는 보존", () => {
    const row = "QWxhZGRpbjpvcGVuIHNlc2FtZTEyMzQ1Njc4OTAxMjM0NTY3ODkw";
    const out = markdownToNote(
      `제목\n\ndata:image/png;base64,\n${row}\n${row}\n${row}\n\n본문\n\n\`\`\`\n${row}\n${row}\n${row}\n\`\`\`\n\nID: abcdef1234567890`,
    );
    expect(out.text).not.toContain(row);
    expect(out.text).toContain("본문");
    expect(out.text).toContain("ID: abcdef1234567890");
  });
  it("HTML 실행 요소와 위험 스킴을 제외하고 본문·엔티티만 보존", () => {
    const out = markdownToNote(
      '<div>보이는 &amp; 글<script>alert(1)</script><style>bad</style><img src="https://tracker.invalid/a"></div>\n\n[실행](javascript:alert(1))\n\n[로컬](file:///etc/passwd)',
    );
    expect(out.text).toContain("보이는 & 글");
    expect(out.text).not.toContain("alert");
    expect(out.text).not.toContain("bad");
    expect(links(out.content)).toEqual([]);
  });
  it("첨부만 있는 문서는 빈 메모로 판정", () => {
    const out = markdownToNote("![](data:image/png;base64,AAAA)");
    expect(out.text.trim()).toBe("");
    expect(out.excluded).toBe(true);
  });
});
