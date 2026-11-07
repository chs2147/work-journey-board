import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
/** Real PDF rasterization: headers/page count/text extraction alone cannot detect invisible fonts. */
export function checkPdfRendering(path: string) {
  const text = execFileSync("pdftotext", [path, "-"], { encoding: "utf8" });
  expect(text).toContain("가상 한글 PDF");
  expect(text).toContain("가상 문서");
  expect(text).toContain("본문 렌더링 검증");
  execFileSync("pdftoppm", ["-f", "1", "-singlefile", "-scale-to", "900", "-gray", path, path + "-render"]);
  const image = readFileSync(path + "-render.pgm");
  const header = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(image.subarray(0, 100).toString("ascii"));
  expect(header).not.toBeNull();
  const width = Number(header![1]),
    height = Number(header![2]),
    offset = header![0].length;
  // Title and body separately; a page with only a footer, title, or table lines must fail.
  const ink = (y0: number, y1: number) => {
    let n = 0;
    for (let y = Math.floor(height * y0); y < Math.floor(height * y1); y++)
      for (let x = Math.floor(width * 0.07); x < Math.floor(width * 0.85); x++)
        if (image[offset + y * width + x]! < 150) n++;
    return n;
  };
  expect(ink(0.04, 0.12)).toBeGreaterThan(400);
  expect(ink(0.12, 0.6)).toBeGreaterThan(400);
}
