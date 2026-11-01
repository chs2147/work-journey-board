// 만든 이 표시(sanbonjini) 로고 — 공식 브랜드 키트 v2.0.0 파일을 수정 없이 쓰는지(release-phase2-spec 0·5절).
// 앱·티저 사이트·README 사본이 키트 asset-manifest의 SHA-256과 같아야 한다.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../../src/shared/brand/sanbonjini/manifest.json";

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const expected = Object.fromEntries(manifest.files.map((f) => [f.id, f.sha256]));

describe("sanbonjini 공식 로고 사본", () => {
  it.each([
    ["src/shared/brand/sanbonjini/m1-en-color.svg", "m1-en-color"],
    ["src/shared/brand/sanbonjini/m1-en-reverse.svg", "m1-en-reverse"],
    ["site/brand/m1-en-color.svg", "m1-en-color"],
    ["site/brand/h1-en-color.svg", "h1-en-color"],
    ["docs/brand/m1-en-color.svg", "m1-en-color"],
    ["docs/brand/m1-en-reverse.svg", "m1-en-reverse"],
  ])("%s = 키트 %s", (path, id) => {
    expect(sha(path)).toBe(expected[id]);
  });

  it("스크립트·외부 참조가 없는 SVG", () => {
    for (const f of manifest.files) {
      if (f.id === "h1-en-color") continue; // 앱에는 M1만
      const svg = readFileSync(`src/shared/brand/sanbonjini/${f.id}.svg`, "utf8");
      expect(svg).not.toMatch(/<script|on\w+=|href="http/i);
    }
  });
});
