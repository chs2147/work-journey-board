import { isTauri } from "@tauri-apps/api/core";
import type { BackupFs, VerifyCopy } from "../data/backup";
import type { SqlDriver } from "../data/driver";
import { STR } from "../shared/strings";

// 플랫폼 차이는 이 인터페이스 뒤로만(CLAUDE.md 4-5). 실앱 = Tauri(윈도우), 브라우저 모드 = 개발·테스트용 가짜 폴더.

/** `%LOCALAPPDATA%\WorkJourneyBoard\config.json` 내용. DB를 찾기 위한 정보라 DB 안에 둘 수 없다(data-spec 3-4). */
export interface AppConfig {
  dataDir: string;
}

/** 내보내기 종류 — 저장 대화상자의 파일 형식 거르개와 허용 확장자 */
export type ExportKind = "xlsx" | "image";
export const EXPORT_EXTS: Record<ExportKind, readonly string[]> = {
  xlsx: [".xlsx"],
  image: [".png", ".webp"],
};

export interface PathInfo {
  exists: boolean;
  isDir: boolean;
  size: number | null;
}

export interface Platform {
  readonly kind: "tauri" | "browser";
  /** 현재 시각. 브라우저 모드는 테스트용으로 날짜를 고정할 수 있다. */
  now(): Date;

  loadConfig(): Promise<AppConfig | null>;
  saveConfig(config: AppConfig): Promise<void>;

  /** 첫 실행 추천 폴더: `C:\Users\<사용자>\WorkJourney` (문서 폴더 아님, overview 10-8) */
  suggestedDataDir(): Promise<string>;
  /** 폴더 선택 대화상자. 취소하면 null */
  pickFolder(title: string): Promise<string | null>;
  /** OneDrive 동기화 폴더인가(환경 변수 경로가 접두어이거나 경로에 \OneDrive 포함) */
  isOneDrivePath(path: string): Promise<boolean>;
  stat(path: string): Promise<PathInfo>;
  ensureDir(path: string): Promise<void>;
  /** 새 파일로만 복사(대상이 있으면 실패) */
  copyNew(from: string, to: string): Promise<void>;
  openFolder(path: string): Promise<void>;
  /** 내보내기 저장: 저장 대화상자(같은 이름이면 대화상자가 덮어쓰기를 묻는다)에서 고른 경로. 취소하면 null */
  pickSaveFile(title: string, defaultPath: string, kind?: ExportKind): Promise<string | null>;
  /**
   * 내보내기 파일 쓰기 — 엑셀 `.xlsx`와 메모 이미지 `.png`·`.webp`만, 일지 파일·backups 폴더는 거부
   * (CLAUDE.md 4-3 내보내기 예외). Rust `export_write`가 한 번 더 검사한다.
   */
  writeExport(path: string, bytes: Uint8Array): Promise<void>;
  /** 파일을 그 파일의 기본 프로그램으로 열기(내보낸 엑셀 [파일 열기]) */
  openFile(path: string): Promise<void>;
  /** 링크를 OS 기본 브라우저로 열기 — http/https만(improve-1026-spec 9-2). 앱은 주소에 접속하지 않는다. Rust `open_url`이 한 번 더 검사 */
  openUrl(url: string): Promise<void>;
  /** 클립보드에 글 쓰기 — 사용자가 [복사]를 누를 때만 부른다(output-spec 5-2) */
  writeClipboard(text: string): Promise<void>;
  join(...parts: string[]): string;

  openDatabase(path: string): Promise<SqlDriver>;
  verifyCopy: VerifyCopy;
  backupFs: BackupFs;

  /** 창을 닫기 직전에 실행(저장·종료 백업). 끝나면 창이 닫힌다. */
  onExit(handler: () => Promise<void>): void;

  /** 시작 스플래시 창(실앱만, docs/splash-spec.md). 브라우저 모드에는 없다. */
  readonly splash?: SplashWindow;
}

export interface SplashWindow {
  /** 스플래시 창의 진행 문구를 바꾼다. 창이 이미 닫혔으면 아무것도 하지 않는다. */
  status(text: string): void;
  /** 메인 창을 보이고 스플래시 창을 닫는다. */
  finish(): Promise<void>;
}

export async function loadPlatform(): Promise<Platform> {
  if (isTauri()) return (await import("./tauri")).tauriPlatform;
  return (await import("./browser")).browserPlatform;
}

/** 경로의 폴더 부분(윈도우 `\\`·`/` 모두) */
export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}

/** 경로의 파일 이름 부분 */
export function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return path.slice(i + 1);
}

/** 내보내기 경로 검사(Rust `export_write`와 같은 규칙 — 웹 앱에서도 먼저 막는다) */
export function exportPathProblem(path: string, dataDir: string, kind: ExportKind = "xlsx"): string | null {
  const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const name = baseName(path).toLowerCase();
  if (!EXPORT_EXTS[kind].some((ext) => name.endsWith(ext) && name.length > ext.length))
    return kind === "image" ? STR.note.onlyImage : STR.export.onlyXlsx;
  if (norm(dirOf(path)) === `${norm(dataDir)}\\backups`) return STR.export.notBackups;
  return null;
}

/** OneDrive 판정 공통 규칙 */
export function isOneDriveLike(path: string, roots: string[]): boolean {
  const p = path.replace(/\//g, "\\").toLowerCase();
  return (
    roots.some((r) => r && p.startsWith(r.replace(/\//g, "\\").toLowerCase())) ||
    /\\onedrive(\\|$| - )/.test(p)
  );
}
