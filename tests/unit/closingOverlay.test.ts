// 온라인 공간 닫는 중 덮개(91문서 5-3): 바로 DOM에 그려지고, 클릭·키 입력이 뒤 화면에 닿지 않는다
import { describe, expect, it } from "vitest";
import { hideClosingOverlay, setClosingText, showClosingOverlay } from "../../src/ui/common/closingOverlay";

describe("닫는 중 덮개", () => {
  it("한 번만 그려지고, 아래 화면으로 가는 클릭·키를 막는다", () => {
    let clicked = 0;
    const btn = document.createElement("button");
    btn.addEventListener("click", () => clicked++);
    document.body.appendChild(btn);
    btn.focus();
    showClosingOverlay("저장하고 종료하는 중…");
    showClosingOverlay("저장하고 종료하는 중…");
    const el = document.querySelectorAll("#wjb-closing");
    expect(el).toHaveLength(1);
    expect(el[0]!.textContent).toBe("저장하고 종료하는 중…");
    expect(el[0]!.getAttribute("aria-modal")).toBe("true");
    expect(btn.inert).toBe(true);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    el[0]!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(clicked).toBe(0);
    const key = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    el[0]!.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    setClosingText("서버와 동기화 중…");
    expect(el[0]!.querySelector('[role="status"]')?.textContent).toBe("서버와 동기화 중…");
    hideClosingOverlay();
    expect(btn.inert).toBe(false);
    expect(document.activeElement).toBe(btn);
    btn.remove();
  });
});
