import { useSyncExternalStore } from "react";

/** CSS 미디어 쿼리가 맞는지(창 크기 변화를 따라감) */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia?.(query);
      mq?.addEventListener("change", onChange);
      return () => mq?.removeEventListener("change", onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
  );
}

/** 창 안쪽 폭(px, 크기 변화를 따라감) */
export function useWindowWidth(): number {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    },
    () => window.innerWidth,
  );
}
