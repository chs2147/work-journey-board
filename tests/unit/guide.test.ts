// 빠른 이용 가이드(features-1102-spec F6): 장면 마크다운 변환, 원본 ↔ 만든 HTML·그림·대응표 검사(CI와 같은 규칙).
import { describe, expect, it } from "vitest";
// @ts-expect-error — 빌드 도구(.mjs)는 형식 선언이 없다
import { buildHtml, check, mdToHtml, readScenes } from "../../scripts/guide/guide.mjs";

describe("scripts/guide", () => {
  it("장면 마크다운 → 번호 순서·목록·표·그림·글 안 서식", () => {
    const html = mdToHtml(
      "**언제 쓰나요** — 매일.\n\n1. `Alt+4` 열기\n2. [가이드](#s2) 보기\n\n![화면](shots/x.png)\n\n- 팁 <b>\n\n| 키 | 동작 |\n|---|---|\n| `F3` | 다음 |\n",
    ) as string;
    expect(html).toContain('<p class="lead"><strong>언제 쓰나요</strong> — 매일.</p>');
    expect(html).toContain(
      '<ol class="steps"><li><code>Alt+4</code> 열기</li><li><a href="#s2">가이드</a> 보기</li></ol>',
    );
    expect(html).toContain(
      '<figure><img src="shots/x.png" alt="화면"><figcaption>화면</figcaption></figure>',
    );
    expect(html).toContain("<li>팁 &lt;b&gt;</li>");
    expect(html).toContain("<td><code>F3</code></td><td>다음</td>");
  });

  it("지금 저장소: 12장면 + 부록, 대응표·그림·만든 HTML·PDF가 원본과 맞다(CI guide.mjs check)", () => {
    const scenes = readScenes() as { num: number }[];
    expect(scenes.map((s) => s.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 90]);
    expect(check()).toEqual([]);
    expect(buildHtml()).toContain('id="s11"');
  });
});
