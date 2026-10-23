import { create } from "zustand";
import type { Platform } from "../../platform";
import type { SqlDriver } from "../../data/driver";

// 화면 상태 전용 스토어. 영속 데이터는 저장소(JournalRepository) 경유로만 다룬다(CLAUDE.md 2절).
export type JournalStatus =
  | { state: "loading" }
  | { state: "ready"; driver: SqlDriver; sqliteVersion: string }
  | { state: "not-configured" }
  | { state: "error"; message: string };

interface AppState {
  platform: Platform | null;
  journal: JournalStatus;
  setPlatform(platform: Platform): void;
  setJournal(journal: JournalStatus): void;
}

export const useAppStore = create<AppState>((set) => ({
  platform: null,
  journal: { state: "loading" },
  setPlatform: (platform) => set({ platform }),
  setJournal: (journal) => set({ journal }),
}));
