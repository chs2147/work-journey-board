// 보드 화면 공용 순수 함수(컴포넌트 파일과 분리 — React Fast Refresh 규칙).

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
