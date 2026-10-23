// 보드 화면 공용 함수·훅(컴포넌트 파일과 분리 — React Fast Refresh 규칙).
import { useEffect, type RefObject } from "react";

/** 한글 IME 조합 중 키 입력인가. 조합 중의 Enter·Tab은 글자 확정용이므로 처리하지 않는다. */
export function isComposingKey(e: { nativeEvent: { isComposing?: boolean }; keyCode: number }): boolean {
  return Boolean(e.nativeEvent.isComposing) || e.keyCode === 229;
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
