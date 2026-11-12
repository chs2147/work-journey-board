// 칸반 화면 공용(improve-v21-spec): 모달 창 훅 — 컴포넌트 파일과 나눠 둔다(빠른 새로 고침 규칙).
import { useEffect, useRef } from "react";

/** <dialog>.showModal() — 최상위 레이어(1.24.2와 같은 방식), Esc = 닫기, 키 입력이 전역 단축키로 새지 않게 */
export function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const prev = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    // React(루트 요소)가 받은 뒤 document에서 멈춘다 — 창 안 입력기는 동작하고 window의 전역 단축키로는 새지 않는다
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.target instanceof Node && d.contains(e.target)) e.stopPropagation();
    };
    d.addEventListener("cancel", cancel);
    document.addEventListener("keydown", key);
    return () => {
      d.removeEventListener("cancel", cancel);
      document.removeEventListener("keydown", key);
      if (d.open) d.close();
      prev?.focus?.();
    };
  }, []);
  return ref;
}
