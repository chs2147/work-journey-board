// 개선 v20(improve-v20-spec) 화면 문구 — 업무노트 삭제 잠금·삭제 확인·복제
export const V20 = {
  lockOn: "삭제 잠김",
  lockOff: "삭제 잠금",
  lockOnTitle: "삭제 잠김 — 누르면 잠금을 풉니다(편집·내보내기는 그대로)",
  lockOffTitle: "삭제 잠금 — 실수로 지우지 못하게 잠급니다",
  lockedHint: "삭제 잠금을 풀어야 지울 수 있습니다",
  lockedRow: "삭제 잠김 — 편집 화면에서 잠금을 풀어야 지울 수 있습니다",
  duplicate: "노트 복제",
  duplicated: (title: string) => `복제했습니다 — ${title}`,
  open: "열기",
  dialogTitle: "업무노트를 삭제할까요?",
  dialogMeta: (task: string, saved: string, images: number) =>
    `${task} · 마지막 저장 ${saved}${images ? ` · 이미지 ${images}개` : ""}`,
  dialogRefs: (n: number) =>
    n ? `이 노트를 가리키는 연결 ${n}곳(보드 카드는 "원본 없음"으로 표시)` : "이 노트를 가리키는 연결 없음",
  dialogWarn: "삭제하면 되돌릴 수 없습니다. 필요하면 먼저 [내보내기]로 저장하세요.",
  cancel: "취소",
  delete: "삭제",
  deleting: "삭제 중…",
} as const;
