// 빠른 이용 가이드(features-1102-spec F6): 장면 마크다운 변환, 원본 ↔ 만든 HTML·그림·대응표 검사(CI와 같은 규칙).
import { describe, expect, it } from "vitest";
// @ts-expect-error — 빌드 도구(.mjs)는 형식 선언이 없다
import { buildHtml, check, macKeys, mdToHtml, readScenes } from "../../scripts/guide/guide.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { macText } from "../../src/shared/platformText";

describe("scripts/guide", () => {
  it("장면 마크다운 → 번호 순서·목록·표·그림·글 안 서식", () => {
    const html = mdToHtml(
      "**언제 쓰나요** — 매일.\n\n1. `Alt+4` 열기\n2. [가이드](#s2) 보기\n\n![화면](shots/x.png)\n\n- 팁 <b>\n\n| 키 | 동작 |\n|---|---|\n| `F3` | 다음 |\n",
    ) as string;
    expect(html).toContain('<p class="lead"><strong>언제 쓰나요</strong> — 매일.</p>');
    expect(html).toContain(
      '<ol class="steps"><li><code>Alt+4</code><span class="mac"> (<code>⌥4</code>)</span> 열기</li><li><a href="#s2">가이드</a> 보기</li></ol>',
    );
    expect(html).toContain(
      '<figure><img src="shots/x.png" alt="화면"><figcaption>화면</figcaption></figure>',
    );
    expect(html).toContain("<li>팁 &lt;b&gt;</li>");
    expect(html).toContain("<td><code>F3</code></td><td>다음</td>");
  });

  it("단축키는 윈도우 표기 옆에 맥 표기를 괄호로(macos-spec 3-2), 탐색기는 (Finder)", () => {
    const html = mdToHtml("- `Ctrl+Shift+F` 검색 · `Alt+1` · `Enter` · 탐색기에서 열기\n") as string;
    expect(html).toContain('<code>Ctrl+Shift+F</code><span class="mac"> (<code>⇧⌘F</code>)</span>');
    expect(html).toContain('<code>Alt+1</code><span class="mac"> (<code>⌥1</code>)</span>');
    expect(html).toContain("<code>Enter</code> ·"); // 맥도 같은 키는 덧붙이지 않음
    expect(html).toContain("탐색기(Finder)에서 열기");
  });

  it("가이드의 맥 표기 규칙 = 앱 문구의 맥 표기 규칙(platformText.macText) — 가이드 원본의 모든 코드 조각", () => {
    const dir = "docs/guide";
    const spans = readdirSync(dir)
      .filter((f) => /^\d\d-.*\.md$/.test(f))
      .flatMap((f) => [...readFileSync(`${dir}/${f}`, "utf8").matchAll(/`([^`]+)`/g)].map((m) => m[1]!));
    expect(spans.length).toBeGreaterThan(20);
    for (const s of spans) expect(macKeys(s), s).toBe(macText(s).replace(/Finder/g, "탐색기"));
  });

  it("지금 저장소: 14장면 + 부록, 대응표·그림·만든 HTML·PDF가 원본과 맞다(CI guide.mjs check)", () => {
    const scenes = readScenes() as { num: number }[];
    expect(scenes.map((s) => s.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 90]);
    expect(check()).toEqual([]);
    expect(buildHtml()).toContain('id="s11"');
  });
});
