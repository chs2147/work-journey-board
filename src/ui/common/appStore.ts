import { create } from "zustand";
import type { Platform } from "../../platform";
import type { SqlDriver } from "../../data/driver";
import type { JournalRepository } from "../../data/repository";
import type { ThemePref } from "../../shared/theme";

// 앱 수준 화면 상태(어느 화면을 보여 줄지). 영속 데이터는 저장소(JournalRepository) 경유로만 다룬다(CLAUDE.md 2절).
export type JournalStatus =
  | { state: "loading" }
  | { state: "first-run" }
  | { state: "missing"; dataDir: string }
  | { state: "integrity"; dataDir: string; path: string }
  | { state: "ready"; driver: SqlDriver; repo: JournalRepository; dataDir: string; sqliteVersion: string }
  | { state: "error"; message: string };

interface AppState {
  platform: Platform | null;
  journal: JournalStatus;
  settingsOpen: boolean;
  /** 화면 테마(improve-1027v5-spec 4절) — 이 PC 설정 */
  theme: ThemePref;
}

export const useAppStore = create<AppState>(() => ({
  platform: null,
  journal: { state: "loading" },
  settingsOpen: false,
  theme: "system",
}));
