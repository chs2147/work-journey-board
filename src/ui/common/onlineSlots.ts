// 온라인 화면 끼움 자리(docs/v2-design/95 UX-3) — Connected Preview가 온라인 공간을 열 때만 채운다.
// 비어 있으면(정식판·DEV) 레일 공간 단추·상단 "저장됨" 알약·Ctrl+Alt+숫자는 지금 그대로다.
import type { ComponentType } from "react";

export interface SaveStatusProps {
  saving: boolean;
  error?: string;
  onRetry?: () => void;
  savedAt?: string | null;
}

export interface OnlineSlots {
  /** 레일 맨 위 공간 단추(+ 공간 메뉴) */
  RailButton: ComponentType;
  /** 상단 오른쪽 저장 상태 자리 — 이 기기 저장 실패는 그대로 보여야 하므로 같은 값을 받는다 */
  StatusPill: ComponentType<SaveStatusProps>;
  /** 설정 › 워크스페이스 목록 자리 — 온라인 공간 목록(이 PC 새 공간·기존 폴더 추가는 온라인 공간 안에서 만들지 않음) */
  WorkspaceSettings: ComponentType;
  /** Ctrl+Alt+n = n번째 온라인 공간 */
  switchAt(n: number): void;
}

let slots: OnlineSlots | null = null;

export function setOnlineSlots(s: OnlineSlots | null) {
  slots = s;
}
export function onlineSlots(): OnlineSlots | null {
  return slots;
}
