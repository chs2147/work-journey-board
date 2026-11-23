// v25 S3(CodeQL 알림 정리): 태그 지우기는 다시 생기는 태그까지 반복, 코드 조각은 울타리 길이로(역슬래시 이스케이프 아님)
import { describe, expect, it } from "vitest";
import { codeSpan, htmlToPlainText } from "../../src/domain/cabiMarkdown";
import { firstAnchor } from "../../src/domain/cabinet";

describe("HTML → 글자(cabiMarkdown)", () => {
  it("겹친 태그·스크립트를 다 지우고 꺾쇠를 남기지 않는다", () => {
    expect(htmlToPlainText("<scr<script>ipt>alert(1)</script>")).not.toMatch(/[<>]/);
    expect(htmlToPlainText("<p>가상 <b>메모</b></p>")).toBe("가상 메모");
    expect(htmlToPlainText("<script>x()</script >남음")).toBe("남음");
    expect(htmlToPlainText("<<b>i</b>mg src=x onerror=1>")).not.toMatch(/[<>]/);
  });
});

describe("코드 조각(cabiMarkdown 내보내기)", () => {
  it("글 안의 가장 긴 ` 묶음보다 긴 울타리, 앞뒤 `면 한 칸 띄움", () => {
    expect(codeSpan("npm test")).toBe("`npm test`");
    expect(codeSpan("a`b")).toBe("``a`b``");
    expect(codeSpan("``x")).toBe("``` ``x ```");
    expect(codeSpan("a\\`b")).toBe("``a\\`b``");
  });
});

describe("끌어 놓은 링크 제목(cabinet)", () => {
  it("제목의 태그는 반복해서 지우고, 엔티티로 쓴 꺾쇠 글자는 남긴다", () => {
    const a = firstAnchor('<a href="https://example.com/a">가상 <<b>b</b>>제목 &lt;초안&gt;</a>');
    expect(a?.url).toBe("https://example.com/a");
    expect(a?.title).toBe("가상 b제목 <초안>");
  });
});
