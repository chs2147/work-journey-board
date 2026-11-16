// 윈도우·맥은 파일 이름의 대소문자를 가르지 않는다 — 대소문자만 다른 두 파일이 있으면 그 두 곳의 빌드가 깨진다
// (리눅스 CI는 통과해 버림: UX-3 onlineSpaces.ts ↔ OnlineSpaces.tsx). 확장자를 뺀 이름도 같은 모듈로 잡힌다.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function clashes(dir: string): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    const stem = e.isDirectory() ? e.name : e.name.replace(/\.(tsx?|jsx?|mjs|css)$/, "");
    const key = stem.toLowerCase() + (e.isDirectory() ? "/" : "");
    const had = seen.get(key);
    if (had && had !== stem) out.push(`${join(dir, had)} ↔ ${full}`);
    else seen.set(key, stem);
    if (e.isDirectory()) out.push(...clashes(full));
  }
  return out;
}

describe("파일 이름 대소문자", () => {
  it.each(["src", "tests", "scripts", "poc"])("%s 안에 대소문자만 다른 이름이 없다", (dir) => {
    expect(clashes(dir)).toEqual([]);
  });
});
