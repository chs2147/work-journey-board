// 엑셀 행 높이 계산(output-spec 3-1). ExcelJS는 자동 맞춤이 없으므로 글 폭으로 직접 계산한다.
// 표시폭: 한글·전각 문자 2, 그 외 1. 열 너비 단위(문자 수)와 같은 눈금으로 본다.

/** 한 글자의 표시폭(한글·한자·전각 기호·전각 영숫자 2, 그 외 1) */
export function charWidth(ch: string): number {
  const c = ch.codePointAt(0)!;
  if (
    (c >= 0x1100 && c <= 0x115f) || // 한글 자모(초성)
    (c >= 0x2e80 && c <= 0xa4cf) || // CJK 부수·기호·한자·가나·한글 호환 자모 등
    (c >= 0xac00 && c <= 0xd7a3) || // 한글 음절
    (c >= 0xf900 && c <= 0xfaff) || // CJK 호환 한자
    (c >= 0xfe30 && c <= 0xfe4f) || // CJK 호환 형태
    (c >= 0xff00 && c <= 0xff60) || // 전각 영숫자·기호
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x20000 && c <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
}

/** 줄 수 = Σ(각 줄 ceil(표시폭 / 열 너비)), 빈 줄도 1줄 */
export function wrappedLines(text: string, columnWidth: number): number {
  const width = Math.max(1, columnWidth);
  return text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(displayWidth(line) / width)), 0);
}

export const MIN_ROW_HEIGHT = 15;
const LINE_HEIGHT = 13.5;
const PADDING = 3;

/** 행 높이(pt) = max(15, 줄 수 × 13.5 + 3) — 행 안 칸들 중 가장 큰 값. 칸 = [글, 열 너비(병합이면 합계)] */
export function rowHeight(cells: { text: string; width: number }[]): number {
  const lines = cells.reduce((m, c) => Math.max(m, c.text ? wrappedLines(c.text, c.width) : 0), 0);
  return Math.max(MIN_ROW_HEIGHT, lines * LINE_HEIGHT + PADDING);
}
