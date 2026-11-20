// @vitest-environment node
// G-8(docs/v2-design/104): 앱 안 안내 글 = 104문서(정본)와 같은 문장, 동의 판 비교, 설정(config.json) 읽기.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTACT,
  CONTACT_PLACEHOLDER,
  ONLINE_TERMS,
  TERMS_VERSION,
  termsAccepted,
  withContact,
} from "../../src/shared/onlineTerms";
import { parseConfig } from "../../src/platform";

const doc = readFileSync(
  new URL("../../docs/v2-design/104-g8-privacy-terms-draft.md", import.meta.url),
  "utf8",
)
  // 문서 꾸밈(굵게·코드)은 빼고 문장만 비교
  .replaceAll("**", "")
  .replaceAll("`", "")
  .replace(/\s+/g, " ");
const plain = (s: string) => withContact(s.replace(/^- /, "")).replace(/\s+/g, " ");

describe("온라인 기능 안내(G-8)", () => {
  it("모든 제목·문단이 104문서에 그대로 있다(앱만 고치고 문서를 잊지 않게)", () => {
    for (const d of Object.values(ONLINE_TERMS)) {
      expect(doc).toContain(d.title);
      if (d.intro) expect(doc).toContain(plain(d.intro));
      for (const s of d.sections) {
        expect(doc).toContain(s.title.replace(/^(\d)\. /, "$1. "));
        for (const l of s.lines) expect(doc).toContain(plain(l));
      }
      if (d.footer) expect(doc).toContain(d.footer);
    }
  });
  it("문의 이메일이 채워져 있다(출시 판) — 자리 표시가 남지 않는다", () => {
    expect(CONTACT).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    expect(withContact("문의 {contact}")).toBe(`문의 ${CONTACT}`);
    expect(doc).not.toContain(CONTACT_PLACEHOLDER);
  });
  it("동의는 지금 판만 인정(판이 바뀌면 다시 묻는다)", () => {
    expect(termsAccepted({ version: TERMS_VERSION })).toBe(true);
    expect(termsAccepted({ version: "old" })).toBe(false);
    expect(termsAccepted(null)).toBe(false);
  });
  it("설정 파일: 동의 기록을 읽고, 모양이 틀린 값은 버린다", () => {
    const at = "2026-11-18T00:00:00.000Z";
    expect(
      parseConfig(JSON.stringify({ dataDir: "/d", onlineTerms: { version: TERMS_VERSION, acceptedAt: at } }))
        ?.onlineTerms,
    ).toEqual({
      version: TERMS_VERSION,
      acceptedAt: at,
    });
    expect(
      parseConfig(JSON.stringify({ dataDir: "/d", onlineTerms: { version: 1 } }))?.onlineTerms,
    ).toBeUndefined();
    expect(parseConfig(JSON.stringify({ dataDir: "/d", onlineTerms: "yes" }))?.onlineTerms).toBeUndefined();
  });
});
