import { isTauri } from "@tauri-apps/api/core";
import type { SqlDriver } from "../data/driver";

// 플랫폼 차이는 이 인터페이스 뒤로만(CLAUDE.md 4-5). S4에서 폴더 선택·설정·OneDrive 감지 등이 추가된다.
export interface Platform {
  readonly kind: "tauri" | "browser";
  /** 일지 DB를 연다. 저장 폴더가 아직 정해지지 않았으면 null(→ 첫 실행 화면, S4). */
  openJournal(): Promise<SqlDriver | null>;
}

export async function loadPlatform(): Promise<Platform> {
  if (isTauri()) return (await import("./tauri")).tauriPlatform;
  return (await import("./browser")).browserPlatform;
}
