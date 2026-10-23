// 앱 아이콘·워드마크(docs/brand-spec.md): 그림의 단일 출처(src/shared/brand)와 스플래시 창·설치 아이콘이 어긋나지 않는지.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STR } from "../../src/shared/strings";

const read = (p: string) => readFileSync(p, "utf8");
const wordmark = read("src/shared/brand/wordmark.svg");
const icon = read("src/shared/brand/icon.svg");
const splash = read("splash.html");

const parse = (markup: string) => new DOMParser().parseFromString(markup, "text/html");
/** 요소 이름 + 속성 목록(공백·줄바꿈 서식 차이는 무시) */
const shape = (svg: Element) =>
  [svg, ...svg.querySelectorAll("*")].map((e) =>
    [
      e.tagName.toLowerCase(),
      ...[...e.attributes].map((a) => `${a.name}=${a.value.replace(/\s+/g, " ").trim()}`).sort(),
    ].join(" "),
  );
const fileSvg = (markup: string) => parse(markup).querySelector("svg")!;
const splashDoc = parse(splash);

describe("스플래시 창 = 원본 그림", () => {
  it("워드마크가 wordmark.svg와 같다", () => {
    expect(shape(splashDoc.querySelector(".name svg")!)).toEqual(shape(fileSvg(wordmark)));
  });
  it("아이콘이 icon.svg와 같다", () => {
    expect(shape(splashDoc.querySelector(".logo svg")!)).toEqual(shape(fileSvg(icon)));
  });
});

describe("워드마크", () => {
  const svg = fileSvg(wordmark);
  it("읽히는 이름은 앱 이름", () => {
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe(STR.appName);
  });
  it("글자 윤곽 도형만 — 글꼴 파일·외부 자원에 기대지 않는다", () => {
    expect(svg.querySelector("text, image, use, style, foreignObject")).toBeNull();
    expect(wordmark).not.toMatch(/font-family|href|url\(/);
  });
  it("테마 색을 바꿀 수 있게 기본 글자는 currentColor, 손글씨·밑줄은 클래스", () => {
    expect(svg.querySelector(".wm-b")?.getAttribute("fill")).toBe("currentColor");
    expect(svg.querySelector(".wm-j")).not.toBeNull();
    expect(svg.querySelector(".wm-u")).not.toBeNull();
  });
});

describe("설치 아이콘(src-tauri/icons/icon.ico)", () => {
  it("작업 표시줄·창 제목용 작은 크기부터 큰 크기까지 모두 들어 있다", () => {
    const ico = readFileSync("src-tauri/icons/icon.ico");
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256).sort((a, b) => a - b);
    expect(sizes).toEqual([16, 24, 32, 48, 64, 256]);
  });
});
