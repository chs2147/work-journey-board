import { describe, expect, it } from "vitest";
import { detectOs } from "../../src/shared/os";
import { localizeTree, macText, osText } from "../../src/shared/platformText";
import { STR_BASE } from "../../src/shared/strings";

describe("OS 판정(macos-spec 3-2)", () => {
  it("실앱은 웹뷰 사용자 에이전트, 브라우저 모드는 ?os=mac일 때만 맥", () => {
    expect(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Edg/130", "", true)).toBe("windows");
    expect(detectOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", "", true)).toBe(
      "macos",
    );
    expect(detectOs("Mozilla/5.0 (Macintosh; …)", "", false)).toBe("windows");
    expect(detectOs("", "?sample=1&os=mac", false)).toBe("macos");
    expect(detectOs("", "?os=macos", false)).toBe("macos");
    expect(detectOs("", "?os=machine", false)).toBe("windows");
  });
});

describe("맥 표기(macos-spec 3-2)", () => {
  it.each([
    ["검색 (Ctrl+Shift+F)", "검색 (⇧⌘F)"],
    ["Ctrl+←/→", "⌘←/→"],
    ["Alt+Shift+P", "⌥⇧P"],
    ["Alt+M으로 보드와 오가기", "⌥M으로 보드와 오가기"],
    ["Ctrl+클릭으로 열기", "⌘+클릭으로 열기"],
    ["축소 (Ctrl+- · Ctrl+휠)", "축소 (⌘- · ⌘+휠)"],
    ["배율 (Ctrl+0 = 100%)", "배율 (⌘0 = 100%)"],
    ["설정 (Ctrl+,)", "설정 (⌘,)"],
    ["메모 안에서 Ctrl+Enter", "메모 안에서 ⌘↩"],
    ["Enter 다음 · Shift+Enter 이전 · Esc 지우기", "Enter 다음 · ⇧↩ 이전 · Esc 지우기"],
    ["Enter·F3 다음 · Shift+F3 이전", "Enter·F3 다음 · ⇧F3 이전"],
    ["이 항목 삭제 (Alt+Delete)", "이 항목 삭제 (⌥⌦)"],
    ["같은 칸 안은 Alt+↑/↓도 됨", "같은 칸 안은 ⌥↑/↓도 됨"],
    ["방향키 · Delete · Esc 해제", "방향키 · ⌫ · Esc 해제"],
    ["관계선 해제 (Delete)", "관계선 해제 (⌫)"],
    ["Ctrl+C로 복사하세요", "⌘C로 복사하세요"],
    ["캡처합니다(Win+Shift+S, 표 전체가", "캡처합니다(⇧⌘4, 표 전체가"],
    ["탐색기에서 열기", "Finder에서 보기"],
    ["탐색기의 폴더나", "Finder의 폴더나"],
    ["‘a’ 바로 가기가 가리키는", "‘a’ 가상본이 가리키는"],
    ["윈도우 설정 › 개인 설정 › 색 › 앱 모드를 따릅니다", "macOS 시스템 설정 › 화면 모드를 따릅니다"],
    ["밝은 바탕 — 윈도우가 다크여도", "밝은 바탕 — macOS가 다크여도"],
  ])("%s → %s", (win, mac) => {
    expect(macText(win)).toBe(mac);
    expect(osText(win, "windows")).toBe(win);
  });

  it("'바로 가기가'는 조사까지 자연스럽게", () => {
    // 가상본 + 이(받침) — 문구 원본이 '바로 가기가'라 변환 결과를 고정해 둔다
    expect(macText("바로 가기가")).toBe("가상본이");
  });

  it("문구 묶음 전체: 맥이면 글·함수 결과를 바꾸고, 윈도우면 같은 객체", () => {
    const tree = { a: "Ctrl+Z", b: { c: (n: number) => `상자 ${n}개 · Delete` }, d: ["Alt+1"] };
    expect(localizeTree(tree, "windows")).toBe(tree);
    const mac = localizeTree(tree, "macos");
    expect(mac.a).toBe("⌘Z");
    expect(mac.b.c(2)).toBe("상자 2개 · ⌫");
    expect(mac.d).toEqual(["⌥1"]);
  });

  it("맥 표기로 바꾼 모든 문구에 윈도우 표기(Ctrl·Alt+·탐색기·윈도우·Win+)가 남지 않는다", () => {
    const left: string[] = [];
    const visit = (v: unknown, path: string) => {
      if (typeof v === "string") {
        const m = macText(v);
        if (/\bCtrl\b|\bAlt\+|\bShift\+|탐색기|윈도우|Win\+/.test(m)) left.push(`${path}: ${m}`);
      } else if (typeof v === "function") {
        // 인자 자리를 가상 값(숫자 → 글 차례)으로 채워 결과 글을 본다
        for (const arg of [1, "가"]) {
          try {
            visit((v as (...a: unknown[]) => unknown)(...Array<unknown>(v.length).fill(arg)), `${path}()`);
            break;
          } catch {
            // 다른 가상 값으로
          }
        }
      } else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) visit(x, `${path}.${k}`);
      }
    };
    visit(STR_BASE, "STR");
    expect(left).toEqual([]);
  });
});
