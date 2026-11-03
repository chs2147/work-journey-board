// 보드 화면 공용 함수·훅(컴포넌트 파일과 분리 — React Fast Refresh 규칙).
import { useEffect, type RefObject } from "react";
import { isMac } from "../../shared/os";

/** 한글 IME 조합 중 키 입력인가. 조합 중의 Enter·Tab은 글자 확정용이므로 처리하지 않는다. */
export function isComposingKey(e: {
  nativeEvent: { isComposing?: boolean };
  keyCode: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  code?: string;
}): boolean {
  if (isMacOptionShortcut(e)) return false;
  return Boolean(e.nativeEvent.isComposing) || e.keyCode === 229;
}

const enterTimers = new WeakMap<HTMLInputElement, ReturnType<typeof setTimeout>>();

/**
 * 한 줄 이름 입력란(첫 실행 업무 이름 · [+ 업무 추가])의 Enter = 추가(improve-1103v8-spec T2).
 * 한글 조합을 확정한 Enter도 추가로 본다 — 맥 WebKit은 그 Enter를 조합 중 키(229)로만 보내 한 번 더 눌러야 했다.
 * 조합 중 Enter는 확정 직후(30ms) 한 번 추가하고, 윈도우처럼 확정 뒤 Enter가 한 번 더 오면 그쪽으로 한 번만.
 * Enter였으면 true(처리함). 칸 편집기(개조식)는 쓰지 않는다 — 매일 기록 동작 그대로.
 */
export function handleEnterCommit(
  e: {
    key: string;
    keyCode: number;
    nativeEvent: { isComposing?: boolean };
    currentTarget: HTMLInputElement;
    preventDefault(): void;
  },
  commit: (el: HTMLInputElement) => void,
): boolean {
  if (e.key !== "Enter") return false;
  const el = e.currentTarget;
  const t = enterTimers.get(el);
  if (t) clearTimeout(t);
  enterTimers.delete(el);
  if (Boolean(e.nativeEvent.isComposing) || e.keyCode === 229) {
    enterTimers.set(
      el,
      setTimeout(() => {
        enterTimers.delete(el);
        commit(el);
      }, 30),
    );
    return true;
  }
  e.preventDefault();
  commit(el);
  return true;
}

/** 전역 키 처리기용(DOM KeyboardEvent) — 같은 규칙 */
export function isComposingEvent(e: KeyboardEvent): boolean {
  if (isMacOptionShortcut(e)) return false;
  return e.isComposing || e.keyCode === 229;
}

/**
 * 맥 ⌥+글자·숫자·화살표 단축키(macos-spec 3-2·R2): ⌥E·⌥I·⌥U·⌥N 등은 맥에서 "조합 대기 글쇠"라 keyCode 229로 온다 —
 * 조합으로 보지 않고 단축키로 받는다(처리기가 preventDefault로 특수 글자 입력을 막는다). 윈도우는 그대로
 */
function isMacOptionShortcut(e: {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  code?: string;
}): boolean {
  return isMac && Boolean(e.altKey) && !e.ctrlKey && !e.metaKey && /^(Key|Digit|Arrow)/.test(e.code ?? "");
}

/** 기록 일수 → 순차 색 단계 0~4 (연간 미니맵) */
export function densityLevel(days: number): number {
  if (days <= 0) return 0;
  if (days === 1) return 1;
  if (days === 2) return 2;
  if (days <= 4) return 3;
  return 4;
}

/** 자동 높이 입력칸: 내용 높이에 맞춘다. */
export function autoSize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/**
 * 자동 높이 입력칸을 다시 재야 할 때(웹 글꼴 로딩 완료·칸 폭 변화) measure를 부른다.
 * 그린 시점의 글꼴·폭으로 잰 높이는 글꼴이 늦게 들어오거나 포커스 열이 바뀌어 폭이 달라지면 틀어진다.
 */
export function useRemeasure(target: RefObject<HTMLElement | null>, measure: () => void) {
  useEffect(() => {
    const el = target.current;
    // 폭이 바뀐 경우만 다시 잰다(높이 변화에 반응하면 잴 때마다 다시 불려 무한 반복된다). 다음 프레임에 잰다.
    let lastWidth = el?.getBoundingClientRect().width ?? 0;
    let frame = 0;
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width ?? 0;
            if (Math.abs(w - lastWidth) < 0.5) return;
            lastWidth = w;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
          });
    if (el) ro?.observe(el);
    document.fonts?.addEventListener?.("loadingdone", measure);
    void document.fonts?.ready.then(measure);
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      document.fonts?.removeEventListener?.("loadingdone", measure);
    };
  }, [target, measure]);
}
