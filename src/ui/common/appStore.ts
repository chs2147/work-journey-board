import { create } from "zustand";
import type { Platform } from "../../platform";
import type { SqlDriver } from "../../data/driver";
import type { JournalRepository } from "../../data/repository";
import type { ThemePref } from "../../shared/theme";
import type { WorkspaceEntry } from "../../domain/workspace";

// 앱 수준 화면 상태(어느 화면을 보여 줄지). 영속 데이터는 저장소(JournalRepository) 경유로만 다룬다(CLAUDE.md 2절).
export type JournalStatus =
  | { state: "loading" }
  | { state: "first-run" }
  | { state: "missing"; dataDir: string }
  | { state: "integrity"; dataDir: string; path: string }
  | { state: "ready"; driver: SqlDriver; repo: JournalRepository; dataDir: string; sqliteVersion: string }
  | { state: "error"; message: string }
  /** 일지 데이터(DB 버전)가 이 앱보다 새로움 — 열지 않았다(improve-v22-spec 2절) */
  | { state: "newer"; dataDir: string; fileVersion: number };

interface AppState {
  platform: Platform | null;
  journal: JournalStatus;
  settingsOpen: boolean;
  /** 화면 테마(improve-1027v5-spec 4절) — 이 PC 설정 */
  theme: ThemePref;
  /** 자동 백업이 뒤에서 도는 중(optimize-1031-plan B2) — 상태 줄에 작게 */
  backingUp: boolean;
  /** 이 PC의 워크스페이스 목록(multi-board-spec) — 지금 연 공간은 journal.dataDir */
  workspaces: WorkspaceEntry[];
  /** 공간 전환 목록 팝업(레일 단추·Ctrl+Alt+0) */
  switcherOpen: boolean;
  /** 새 워크스페이스 만들기 창 */
  creatingWorkspace: boolean;
}

export const useAppStore = create<AppState>(() => ({
  platform: null,
  journal: { state: "loading" },
  settingsOpen: false,
  backingUp: false,
  theme: "system",
  workspaces: [],
  switcherOpen: false,
  creatingWorkspace: false,
}));
