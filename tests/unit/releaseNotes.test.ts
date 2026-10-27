// 릴리스 노트 검사·본문 만들기(scripts/release-notes.mjs, improve-1027v3-spec 5절) — 임시 폴더의 가짜 저장소로.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../scripts/release-notes.mjs");

function repo(version: string, opts: { notes?: string; readme?: string }) {
  const dir = mkdtempSync(join(tmpdir(), "relnotes-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version }));
  writeFileSync(join(dir, "README.md"), opts.readme ?? "## Version History\n");
  if (opts.notes !== undefined) {
    mkdirSync(join(dir, "docs", "release-notes"), { recursive: true });
    writeFileSync(join(dir, "docs", "release-notes", `v${version}.md`), opts.notes);
  }
  return dir;
}
const run = (dir: string, ...args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args, "--root", dir], { encoding: "utf8" });

const NOTES = "# 가상 개선 묶음\n\n## 새 기능\n- 가상 기능\n\n## 주의\n- 데이터 형식: 변경 없음\n";
const README = "## Version History\n### v0.2.16 (2026-10-28) — 가상 개선 묶음\n- 가상 기능\n";

describe("release-notes check", () => {
  it("규칙 적용 전 판(0.2.15)은 건너뜀", () => {
    expect(run(repo("0.2.15", {}), "check").status).toBe(0);
  });
  it("노트·README 제목이 있으면 통과", () => {
    expect(run(repo("0.2.16", { notes: NOTES, readme: README }), "check").status).toBe(0);
  });
  it("노트 없음 · 주의 절 없음 · README 제목 없음 = 실패", () => {
    const a = run(repo("0.2.16", { readme: README }), "check");
    expect(a.status).toBe(1);
    expect(a.stderr).toContain("노트 파일이 없습니다");
    const b = run(repo("0.2.16", { notes: "# 요약\n\n## 새 기능\n- 가상\n" }), "check");
    expect(b.status).toBe(1);
    expect(b.stderr).toContain("'## 주의' 절이 없습니다");
    expect(b.stderr).toContain("README Version History");
  });
});

describe("release-notes body", () => {
  it("본문 = 머리 + 굵은 요약·날짜 + 절(### 로) + 설치 파일 표", () => {
    const dir = repo("0.2.16", { notes: NOTES, readme: README });
    const out = join(dir, "body.md");
    expect(run(dir, "body", "0.2.16", "--out", out).status).toBe(0);
    const md = readFileSync(out, "utf8");
    expect(
      md.startsWith(
        "**Work Journey Board v0.2.16** (개발 중 사전 릴리스)\n\n**가상 개선 묶음** — 2026-10-28\n",
      ),
    ).toBe(true);
    expect(md).toContain("### 새 기능\n- 가상 기능");
    expect(md).toContain("### 주의");
    expect(md).toContain("| `WorkJourneyBoard_0.2.16_setup.exe` |");
    expect(md.trimEnd().endsWith("앱은 실행 중 인터넷으로 아무것도 보내지 않습니다.")).toBe(true);
  });
  it("노트가 빠진 새 판은 본문을 만들지 않고 실패", () => {
    expect(run(repo("0.2.16", { readme: README }), "body", "0.2.16").status).toBe(1);
  });
});
