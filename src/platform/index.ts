import { CABI } from "../shared/cabiStrings";
import type { CabiBridge } from "./cabiBridge";
import { normalizeBackupPolicy, type BackupControl } from "../data/backupPolicy";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { BackupFs, VerifyCopy } from "../data/backup";
import type { SqlDriver } from "../data/driver";
import type { FsEntry } from "../domain/cabinet";
import { STR } from "../shared/strings";
import type { WorkspaceEntry } from "../domain/workspace";
import { isThemePref, type ThemePref } from "../shared/theme";

// 플랫폼 차이는 이 인터페이스 뒤로만(CLAUDE.md 4-5). 실앱 = Tauri(윈도우), 브라우저 모드 = 개발·테스트용 가짜 폴더.

/** `%LOCALAPPDATA%\WorkJourneyBoard\config.json` 내용. DB를 찾기 위한 정보라 DB 안에 둘 수 없다(data-spec 3-4). */
export interface AppConfig {
  /** DEV 검증판: 일지를 고른 설치 판 — 판이 바뀌면(새로 설치) 다시 묻는다(docs/release-channel-spec.md 4절) */
  devSetupVersion?: string;
  dataDir: string;
  backupControlBy?: Record<string, BackupControl>;
  /** 화면 테마(improve-1027v5-spec 4-2) — 이 PC 취향이라 일지가 아니라 여기에. 없으면 시스템 설정 */
  theme?: ThemePref;
  universeMotion?: "dynamic" | "static";
  /** 칸반 완료 축하 모션(improve-v22-spec 7절) — 이 PC 취향, 없으면 켬 */
  celebrate?: boolean;
  universeAutoMotion?: boolean;
  universeAutoStyle?: "drift" | "orbit";
  universePanelWidths?: { filter: number; detail: number };
  /** 보조 백업 위치(optimize-1031-plan B6) — 이 PC의 다른 폴더에 일일 사본을 하나 더. 없으면 끔 */
  backupMirror?: string | null;
  /** Cabinet(features-1102-spec F5): 열려 있던 Cabinet 창·폴더 창(하위 위치) — 다음에 켜면 그대로 다시 연다 */
  cabinet?: CabinetConfig;
  /** 워크스페이스 목록(multi-board-spec 7절) — 없으면 dataDir 하나. dataDir = 지금 연 공간(예전 판과 호환되는 자리) */
  workspaces?: WorkspaceEntry[];
  /** 공간마다 Cabinet 창 상태(전환할 때 cabinet과 바꿔 낀다) — 키 = 공간 폴더 */
  cabinetBy?: Record<string, CabinetConfig>;
  /** G-1 통합 앱(docs/v2-design/98): 마지막으로 쓴 공간이 온라인이면 그 공간·계정. 없으면(null) 로컬 dataDir로 시작 */
  lastWorkspace?: LastOnlineWorkspace | null;
  /** G-8(docs/v2-design/104): 이 기기에서 온라인 기능 개인정보·이용 안내에 동의한 판(바뀌면 다시 묻는다) */
  onlineTerms?: { version: string; acceptedAt: string };
}

export interface LastOnlineWorkspace {
  kind: "online";
  workspaceId: string;
  ownerId: string;
}

export interface CabinetConfig {
  open: boolean;
  windows: { id: string; sub: string }[];
}

/** Cabinet 폴더 창 하나(실앱 = 별도 OS 창) */
export interface FolderWindowSpec {
  id: string;
  /** 등록 폴더(뿌리) */
  root: string;
  /** 지금 보는 하위 경로(뿌리 포함 전체 경로) */
  sub: string;
  title: string;
  /** 연결 표시 글(업무·항목) */
  links: string[];
  theme: string;
}

export type FolderWindowEvent = { type: "nav"; id: string; sub: string } | { type: "closed"; id: string };

/** 끌어 놓은 것의 경로 — exists = 그 경로를 찾았는가 */
export interface DroppedPath {
  path: string;
  isDir: boolean;
  exists: boolean;
}

/** Cabinet을 열 때 고를 업무·강조할 항목 */
export interface CabinetFocus {
  categoryId?: string;
  itemId?: string;
}

/**
 * Cabinet 별도 창(실앱만, improve-1102-spec C1) — Cabinet 창은 일지를 열지 않고, 메인 창(일지의 주인)과 이벤트로 주고받는다.
 * 메인 창: open·close·onClosed·serve·sync / Cabinet 창: call·onSync·onFocus·closeSelf·installDropBridge
 */
export interface CabinetWindowBridge {
  open(focus: CabinetFocus | null, theme: string): Promise<void>;
  close(): Promise<void>;
  onClosed(cb: () => void): void;
  serve(handler: (name: string, args: unknown[]) => Promise<unknown>): Promise<void>;
  sync(snapshot: unknown): Promise<void>;
  call(name: string, args: unknown[]): Promise<unknown>;
  onSync(cb: (snapshot: unknown) => void): Promise<() => void>;
  onFocus(cb: (focus: CabinetFocus) => void): Promise<() => void>;
  closeSelf(): Promise<void>;
  installDropBridge(): Promise<void>;
}

/** 폴더 창을 별도 OS 창으로 다루기(실앱만) — 브라우저 모드는 앱 안 떠 있는 창으로 대신한다 */
export interface FolderWindows {
  open(spec: FolderWindowSpec): Promise<void>;
  /** 앱을 닫을 때 — 폴더 창도 모두 닫는다 */
  closeAll(): Promise<void>;
  /** 메인 창: 폴더 창의 이동·닫힘 알림 받기 */
  onEvent(cb: (e: FolderWindowEvent) => void): Promise<() => void>;
  /** 폴더 창 쪽: 하위 위치가 바뀌었다고 메인 창에 알림 */
  notifyNav(id: string, sub: string): Promise<void>;
}

/** 내보내기 종류 — 저장 대화상자의 파일 형식 거르개와 허용 확장자 */
export type ExportKind = "xlsx" | "image" | "markdown" | "markdownImage" | "pdf";
export const EXPORT_EXTS: Record<ExportKind, readonly string[]> = {
  pdf: [".pdf"],
  xlsx: [".xlsx"],
  image: [".png", ".webp"],
  /** 메모 보드 마크다운(features-1102-spec F4) */
  markdown: [".md"],
  /** 마크다운 옆 `<문서 이름>_images` 폴더 안 원본 이미지 — 그 폴더 안에서만 */
  markdownImage: [".png", ".webp", ".jpg", ".jpeg", ".gif"],
};
export const MD_IMAGE_DIR_SUFFIX = "_images";

export interface PathInfo {
  exists: boolean;
  isDir: boolean;
  size: number | null;
  modified?: number | null;
  isSymlink?: boolean;
}

export interface Platform {
  readonly cabi: CabiBridge;
  readonly kind: "tauri" | "browser";
  /** 현재 시각. 브라우저 모드는 테스트용으로 날짜를 고정할 수 있다. */
  now(): Date;

  loadConfig(): Promise<AppConfig | null>;
  /** 주어진 값만 바꾸고 나머지(다른 키 포함)는 그대로 둔다 — 저장 위치를 옮겨도 테마가 남게 */
  saveConfig(patch: Partial<AppConfig>): Promise<void>;
  /** 창 제목(작업 표시줄·Dock) — 워크스페이스 이름을 붙인다(multi-board-spec 3-1) */
  setWindowTitle?(title: string): Promise<void>;
  /** 창 제목 표시줄 테마(system = 윈도우 설정 따름). 브라우저 모드는 할 일 없음 */
  setWindowTheme(pref: ThemePref): Promise<void>;

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
  /** 백업에서 복원(optimize-1031-plan O5) — 지금 일지를 backups\\<beforeName>으로 옮기고 백업을 일지로 복사. Rust가 이름·위치 재검사 */
  restoreJournal(dataDir: string, backupName: string, beforeName: string): Promise<void>;
  openFolder(path: string): Promise<void>;
  /** 내보내기 저장: 저장 대화상자(같은 이름이면 대화상자가 덮어쓰기를 묻는다)에서 고른 경로. 취소하면 null */
  pickSaveFile(title: string, defaultPath: string, kind?: ExportKind): Promise<string | null>;
  /**
   * 내보내기 파일 쓰기 — 엑셀 `.xlsx`·메모 이미지 `.png`·`.webp`·마크다운 `.md`(+ `_images` 폴더 안 이미지)만, 일지 파일·backups 폴더는 거부
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
  /** 맥 메뉴 막대 항목(macos-spec 3-1) — 실앱 맥만 이벤트가 온다(윈도우·브라우저 모드에는 메뉴가 없다) */
  onMenuAction?(handler: (id: string) => void): void;

  /** 시작 스플래시 창(실앱만, docs/splash-spec.md). 브라우저 모드에는 없다. */
  readonly splash?: SplashWindow;
  /** DEV 검증판 일지 폴더(DEV 프로필에서만 있음) */
  readonly dev?: DevJournalOps;
  /** 백업 사본이 앱이 꺼지면 사라지는 곳(Preview 온라인 공간 = 메모리)이면 자동 백업(첫 실행·종료)을 하지 않는다 */
  readonly ephemeralBackups?: boolean;

  // ── Cabinet(features-1102-spec F5) — 등록 폴더를 읽기·열기만(지우기·옮기기 없음), Rust cabinet.rs가 등록 폴더 안인지 재검사 ──
  /** 폴더 여러 개 고르기. 취소하면 null */
  pickFolders(title: string): Promise<string[] | null>;
  /** 등록한 폴더 목록(읽기·열기 허용 범위)을 알린다 */
  cabinetSetRoots(paths: string[]): Promise<void>;
  pickCabinetFolder?(title: string): Promise<string | null>;
  cabinetStat?(path: string): Promise<{ exists: boolean; isDir: boolean }>;
  /** 폴더 안 목록(이름·종류·크기·수정 시각만) */
  cabinetList(path: string): Promise<FsEntry[]>;
  /** 파일·폴더를 OS 기본 앱으로 열기 */
  cabinetOpen(path: string): Promise<void>;
  /** 탐색기에서 그 항목 보기 */
  cabinetReveal(path: string): Promise<void>;
  /** 끌어 놓은 파일·폴더의 경로와 폴더 여부(A안: WebView2 다리). 경로를 받을 수 없으면 null */
  droppedPaths(files: File[]): Promise<DroppedPath[] | null>;
  /** 윈도우 바로 가기(.lnk)가 가리키는 경로(improve-1102v7 K2). 바로 가기가 아니거나 못 읽으면 null */
  resolveShortcut(path: string): Promise<string | null>;
  /** 폴더 창을 별도 OS 창으로(실앱만) */
  readonly folderWindows?: FolderWindows;
  /** Cabinet 창을 별도 OS 창으로(실앱만) — 없으면 앱 안 떠 있는 창 */
  readonly cabinetWindow?: CabinetWindowBridge;

  /**
   * 새 판 확인(improve-1027v4-spec 1절 B안) — GitHub Releases에 묻는다(앱에서 인터넷으로 나가는 유일한 곳, Rust update.rs).
   * 지금보다 높은 판이 없으면 null, 연결 실패는 오류.
   */
  updateCheck(): Promise<UpdateInfo | null>;
  /** 확인한 새 판 설치 파일 내려받기 + SHA256 확인(앱 자료 폴더). 진행은 콜백으로 */
  updateDownload(onProgress: (received: number, total: number) => void): Promise<void>;
  /** 내려받은 설치 파일을 다시 확인하고 실행한 뒤 앱을 닫는다(설치가 끝나면 새 판이 열림) */
  updateInstall(): Promise<void>;
}

/** 새 판 정보 — 주소는 Rust가 들고 있고 웹 화면에는 넘기지 않는다 */
export interface UpdateInfo {
  version: string;
  /** 릴리스 노트 본문(마크다운) */
  notes: string;
  size: number;
  /** SHA256SUMS.txt로 무결성을 확인할 수 있는가 */
  hasHash: boolean;
}

export interface SplashWindow {
  /** 스플래시 창의 진행 문구를 바꾼다. 창이 이미 닫혔으면 아무것도 하지 않는다. */
  status(text: string): void;
  /** 메인 창을 보이고 스플래시 창을 닫는다. */
  finish(): Promise<void>;
}

/**
 * 실행 프로필(V2 6-B, src-tauri/src/profile.rs). Local Classic = 지금 앱 그대로.
 * Connected Preview = 별도 앱 ID·설정 폴더, 업데이트 꺼짐, 기존 로컬 일지를 열지 않음(Rust가 일지 명령을 등록하지 않음).
 */
export interface AppProfileInfo {
  key: "local-classic" | "connected-preview" | "local-dev";
  appId: string;
  productName: string;
  updates: boolean;
  localJournal: boolean;
  /** 비공식 판(Preview·DEV) — DEV 배지·타이틀 색(docs/release-channel-spec.md) */
  unofficial: boolean;
}

export const CLASSIC_PROFILE: AppProfileInfo = {
  key: "local-classic",
  appId: "com.chs2147.workjourneyboard",
  productName: "Work Journey Board",
  updates: true,
  localJournal: true,
  unofficial: false,
};

/** DEV 검증판(비공식 로컬판) — 정식판과 앱 ID·설정 폴더가 다르고, DEV 표시가 있는 일지만 연다 */
export const DEV_PROFILE: AppProfileInfo = {
  key: "local-dev",
  appId: "com.chs2147.workjourneyboard.dev",
  productName: "Work Journey Board DEV",
  updates: false,
  localJournal: true,
  unofficial: true,
};

export const PREVIEW_PROFILE: AppProfileInfo = {
  key: "connected-preview",
  appId: "com.chs2147.workjourneyboard.connected.preview",
  productName: "Work Journey Board Connected Preview",
  updates: false,
  localJournal: false,
  unofficial: true,
};

/** Rust가 알려 준 값만 받는다. Preview·DEV라고 답하면 그 프로필, 그 밖은 Classic */
export function parseAppProfile(v: unknown): AppProfileInfo {
  const o = (v ?? {}) as Partial<AppProfileInfo>;
  if (o.key === "connected-preview" && o.appId === PREVIEW_PROFILE.appId) return PREVIEW_PROFILE;
  if (o.key === "local-dev" && o.appId === DEV_PROFILE.appId) return DEV_PROFILE;
  return CLASSIC_PROFILE;
}

let active: AppProfileInfo = CLASSIC_PROFILE;
/** 지금 실행 중인 프로필(시작할 때 main.tsx가 1번 정한다) */
export const activeProfile = () => active;
export function setActiveProfile(p: AppProfileInfo) {
  active = p;
}
/** 온라인 공간을 쓸 수 있는 판 — G-9(2026-11-20)부터 정식판·DEV·Preview 모두(서버는 판마다 따로, online.rs) */
export const onlineCapable = () => true;

/** DEV 일지 폴더 상태(Rust dev_guard): dev = DEV 표시 · official = 정식 일지 · empty = 일지 없음 · missing */
export type DevFolderStatus = "dev" | "official" | "empty" | "missing";

/** DEV 검증판 전용 일지 폴더 다루기 — DEV 프로필일 때만 platform.dev가 있다 */
export interface DevJournalOps {
  folderStatus(dir: string): Promise<DevFolderStatus>;
  /** 열기 직전: DEV 표시가 있으면 통과, 일지 없으면 표시를 남김, 정식 일지면 OfficialJournalError */
  prepareFolder(dir: string): Promise<void>;
  /** 정식 일지를 읽기만 해서 dest(일지 없는 폴더)에 복사 + DEV 표시 */
  copyOfficial(src: string, dest: string): Promise<void>;
}

/** 정식 일지는 DEV에서 열지 않는다(docs/release-channel-spec.md 3절) */
export class OfficialJournalError extends Error {
  constructor(readonly dataDir: string) {
    super(`정식판 일지는 DEV에서 열 수 없습니다: ${dataDir}`);
  }
}

/**
 * 시작할 때 1번. 실앱 = Rust `app_profile`. 브라우저 모드 = `?profile=connected-preview`(개발·시험용).
 * 묻기가 실패하면 Classic으로 시작한다 — Classic 빌드는 이 명령을 늘 등록하고, Preview 빌드는 Rust에
 * 일지 명령·SQLite 플러그인 자체가 없어 Classic 화면으로 가도 일지를 열 수 없다.
 */
export async function loadAppProfile(): Promise<AppProfileInfo> {
  if (isTauri()) {
    try {
      return parseAppProfile(await invoke("app_profile"));
    } catch {
      return CLASSIC_PROFILE;
    }
  }
  const q = new URLSearchParams(location.search).get("profile");
  return q === "connected-preview" ? PREVIEW_PROFILE : q === "local-dev" ? DEV_PROFILE : CLASSIC_PROFILE;
}

/** Connected Preview 온라인 계정 상태(토큰 없음 — Rust `online.rs`가 보안 저장소에 보관) */
export interface OnlineStatus {
  state: "signedOut" | "signedIn" | "vaultUnavailable";
  email: string | null;
  accountId: string | null;
  /** gateway가 세션을 확인한 시각(유닉스 초) */
  serverCheckedAt: number | null;
}

/**
 * Connected Preview 계정(V2 B단계, docs/v2-design/79). 실앱 = Rust 명령(개발 프로젝트 인증·gateway만 접속),
 * 브라우저 모드 = 네트워크 없는 시험용 가짜(인증번호 `12345678`). 오류는 대문자 코드 문자열.
 */
export interface PreviewOnline {
  status(): Promise<OnlineStatus>;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<OnlineStatus>;
  check(): Promise<OnlineStatus>;
  signOut(): Promise<OnlineStatus>;
  /** G 운영 준비(docs/v2-design/96): 계정 사용량·관리자 기능(관리자 확인은 서버 함수) */
  account(
    action: "usage" | "admin_list" | "admin_set" | "admin_invite" | "delete_space" | "delete_account",
    params: Record<string, unknown>,
  ): Promise<unknown>;
}

/** 계정 한도(null = 없음)·사용량(바이트, 공간 수) — 서버 SQL 028 `wjb_ops.usage_json` */
export interface AccountUsage {
  limits: { images: number | null; spaces: number | null; records: number | null };
  used: { images: number; spaces: number; records: number };
  unlimited: boolean;
  suspended: boolean;
  admin: boolean;
  /** 관리자만: 프로젝트 전체(안전선 대비) */
  project?: { images: number; imagesLimit: number; db: number; dbLimit: number };
}
export interface AdminAccount extends AccountUsage {
  userId: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  /** 기본값이 아닌 조정이 있는지 */
  custom: boolean;
}

/** C-2 원본 일지 읽기 전용 사본(Preview, Rust source_copy.rs) — 원본 폴더에는 아무것도 만들지 않는다 */
export interface SourceSnapshot {
  snapshotId: string;
  bytes: number;
  sha256: string;
}
export interface PreviewSource {
  /** 원본 일지 폴더 고르기(OS 대화상자) — 취소면 null */
  pickFolder(title: string): Promise<string | null>;
  /** 고른 폴더(일지가 있으면 그 폴더) 또는 바로 아래 하위 폴더 중 일지가 있는 곳 — 목록만 읽음 */
  candidates(dir: string): Promise<string[]>;
  /** 고른 폴더의 일지를 읽기만 해서 Preview 폴더에 사본. 쓰는 중이면 SOURCE_IN_USE */
  snapshot(dir: string): Promise<SourceSnapshot>;
  /** 사본 바이트(sql.js로 열어 이관 자료를 만든다) */
  read(snapshotId: string): Promise<Uint8Array>;
  remove(snapshotId: string): Promise<void>;
}
/** C-3 이관 통신(Preview, Rust migration.rs) — 토큰은 Rust 안에서만. 화면은 네트워크를 쓰지 않는다 */
export interface MigrationJournalAsset {
  objectId: string;
  sha256: string;
  bytes: number;
  state: "pending" | "uploaded" | "attested" | "absent";
}
export type MigrationPhase =
  | "prepared"
  | "uploading-records"
  | "uploading-assets"
  | "publishing"
  | "published"
  | "canceling"
  | "canceled";
/** 이어하기 기록 — ID·해시·크기·단계만(기록 내용·그림 없음, Rust가 모르는 칸을 거절) */
export interface MigrationJournal {
  version: 1;
  jobId: string;
  ownerId: string;
  workspaceId: string;
  snapshotId: string;
  sourceHash: string;
  mappingHash: string;
  manifestHash: string | null;
  publishOperationId: string | null;
  cancelOperationId: string | null;
  pages: number;
  records: number;
  phase: MigrationPhase;
  assets: MigrationJournalAsset[];
  updatedAt: number;
}
export interface PreviewMigration {
  device(): Promise<void>;
  command(jobId: string, action: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  putAsset(workspaceId: string, objectId: string, sha256: string, bytes: Uint8Array): Promise<void>;
  cancelAsset(workspaceId: string, objectId: string): Promise<void>;
  journals(): Promise<MigrationJournal[]>;
  saveJournal(journal: MigrationJournal): Promise<void>;
  removeJournal(jobId: string): Promise<void>;
}
export async function loadPreviewMigration(): Promise<PreviewMigration> {
  if (isTauri()) return (await import("./tauriPreviewMigration")).tauriPreviewMigration;
  return (await import("./browserPreviewMigration")).browserPreviewMigration;
}
/** D단계 내 온라인 공간(Preview, Rust online_space.rs) — 목록·이 기기 캐시 채우기·캐시 파일 읽기 */
export interface OnlineSpaceInfo {
  workspaceId: string;
  manifestHash: string;
  records: number;
  assets: number;
  assetBytes?: number;
  createdAt: string | null;
  sourceSchema: number;
  syncedAt?: number;
  /** 공간 이름·색·아이콘(SQL 025, 동기화된 설정 값 우선) — 서버가 형식을 확인, 화면은 parseMeta로 한 번 더 */
  workspace?: { name: string; color: string; icon: string } | null;
}
export interface SpaceSyncResult {
  workspaceId: string;
  manifestHash: string;
  records: number;
  assets: number;
  downloaded?: number;
  fromCache: boolean;
  stale: boolean;
}
export interface PreviewSpaces {
  /** 서버에 닿지 못하면 이 기기에 받아 둔 공간만(offline: true) */
  list(): Promise<{ workspaces: OnlineSpaceInfo[]; offline?: boolean }>;
  sync(workspaceId: string): Promise<SpaceSyncResult>;
  /** header.json · records.json · complete.json · <sha256>.bin — 완성 캐시에서만 */
  read(workspaceId: string, name: string): Promise<Uint8Array>;
  /** 캐시와 이 기기 일지를 함께 지운다 */
  remove(workspaceId: string): Promise<void>;
  /** E-1 이 기기 일지(파일 경로는 Rust가 정함 — 공간 ID만 넘긴다) */
  journal: SpaceJournalStore;
  /** E-3 동기화 통신(보내기·받기·새 그림 올리기·그림 받기) */
  transport: import("../preview/spaceSync").SyncTransport;
}
/** E-1 온라인 공간의 이 기기 일지(docs/v2-design/89) */
export interface SpaceJournalStore {
  exists(workspaceId: string): Promise<boolean>;
  /** 처음 만들기 — 파일이 없을 때만(있으면 JOURNAL_EXISTS) */
  create(workspaceId: string, bytes: Uint8Array): Promise<void>;
  open(workspaceId: string): Promise<SpaceDriver>;
}
export interface SpaceDriver extends SqlDriver {
  /** 지금 내용의 일관된 사본 바이트(앱의 백업 사본용) */
  exportBytes(): Promise<Uint8Array>;
}
export async function loadPreviewSpaces(): Promise<PreviewSpaces> {
  if (isTauri()) return (await import("./tauriPreviewSpaces")).tauriPreviewSpaces;
  return (await import("./browserPreviewSpaces")).browserPreviewSpaces;
}

/** 앱 화면에 쓸 플랫폼을 바꿔 끼운다(Preview가 온라인 공간을 제품 화면으로 열 때 — D-4). null = 원래대로 */
let platformOverride: Platform | null = null;
export function setPlatformOverride(p: Platform | null) {
  platformOverride = p;
}

export async function loadPreviewSource(): Promise<PreviewSource> {
  if (isTauri()) return (await import("./tauriPreviewSource")).tauriPreviewSource;
  return (await import("./browserPreviewSource")).browserPreviewSource;
}

export async function loadPreviewOnline(): Promise<PreviewOnline> {
  if (isTauri()) return (await import("./tauriPreviewOnline")).tauriPreviewOnline;
  return (await import("./browserPreviewOnline")).browserPreviewOnline;
}

/** 스플래시 창만(Connected Preview 시작 화면용 — 일지·SQLite 모듈을 불러오지 않는다). 브라우저 모드는 없음 */
export async function loadSplash(): Promise<SplashWindow | undefined> {
  if (isTauri()) return (await import("./tauriSplash")).splash;
  return undefined;
}

export async function loadPlatform(): Promise<Platform> {
  if (platformOverride) return platformOverride;
  return loadBasePlatform();
}
/** 이 PC 플랫폼(바꿔 낀 온라인 공간 플랫폼이 아닌 것) — G-1 통합 앱이 로컬 공간으로 돌아갈 때 */
export async function loadBasePlatform(): Promise<Platform> {
  if (isTauri()) return (await import("./tauri")).tauriPlatform;
  return (await import("./browser")).browserPlatform;
}

/** 경로의 폴더 부분(윈도우 `\\`·`/` 모두) */
export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}

/** config.json 글 → 설정(저장 폴더가 없으면 첫 실행 = null). 모르는 테마 값은 버린다 */
export function parseConfig(raw: string | null): AppConfig | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<AppConfig>;
    if (typeof c.dataDir !== "string" || !c.dataDir) return null;
    const out: AppConfig = { dataDir: c.dataDir };
    if (c.backupControlBy && typeof c.backupControlBy === "object" && !Array.isArray(c.backupControlBy)) {
      out.backupControlBy = Object.fromEntries(
        Object.entries(c.backupControlBy)
          .filter(([, v]) => v && typeof v.paused === "boolean")
          .map(([k, v]) => [
            k,
            {
              paused: v.paused,
              ...(v.pendingPolicy ? { pendingPolicy: normalizeBackupPolicy(v.pendingPolicy) } : {}),
              ...(v.lastCleanup &&
              typeof v.lastCleanup.at === "string" &&
              [v.lastCleanup.deleted, v.lastCleanup.failed, v.lastCleanup.freed].every(
                (n) => Number.isFinite(n) && n >= 0,
              )
                ? { lastCleanup: v.lastCleanup }
                : {}),
            },
          ]),
      );
    }
    if (typeof c.devSetupVersion === "string") out.devSetupVersion = c.devSetupVersion;
    const lw = c.lastWorkspace;
    if (
      lw &&
      lw.kind === "online" &&
      typeof lw.workspaceId === "string" &&
      lw.workspaceId &&
      typeof lw.ownerId === "string" &&
      lw.ownerId
    )
      out.lastWorkspace = { kind: "online", workspaceId: lw.workspaceId, ownerId: lw.ownerId };
    const ot = c.onlineTerms;
    if (ot && typeof ot.version === "string" && ot.version && typeof ot.acceptedAt === "string")
      out.onlineTerms = { version: ot.version, acceptedAt: ot.acceptedAt };
    if (typeof c.universeAutoMotion === "boolean") out.universeAutoMotion = c.universeAutoMotion;
    if (typeof c.celebrate === "boolean") out.celebrate = c.celebrate;
    if (c.universeAutoStyle === "drift" || c.universeAutoStyle === "orbit")
      out.universeAutoStyle = c.universeAutoStyle;
    if (c.universeMotion === "dynamic" || c.universeMotion === "static")
      out.universeMotion = c.universeMotion;
    if (
      c.universePanelWidths &&
      Number.isFinite(c.universePanelWidths.filter) &&
      Number.isFinite(c.universePanelWidths.detail)
    )
      out.universePanelWidths = {
        filter: Math.max(220, Math.min(640, c.universePanelWidths.filter)),
        detail: Math.max(220, Math.min(640, c.universePanelWidths.detail)),
      };
    if (isThemePref(c.theme)) out.theme = c.theme;
    if (typeof c.backupMirror === "string" && c.backupMirror) out.backupMirror = c.backupMirror;
    const cab = parseCabinetConfig(c.cabinet);
    if (cab) out.cabinet = cab;
    // 워크스페이스 목록(multi-board-spec 7절) — 버리면 다음 실행에 지금 연 공간 하나만 남는다(1.8.0-rc.1 버그).
    // 줄마다의 검사는 readEntries가 한다
    if (Array.isArray(c.workspaces)) out.workspaces = c.workspaces;
    if (c.cabinetBy && typeof c.cabinetBy === "object" && !Array.isArray(c.cabinetBy)) {
      const by: Record<string, CabinetConfig> = {};
      for (const [k, v] of Object.entries(c.cabinetBy)) {
        const one = parseCabinetConfig(v);
        if (one) by[k] = one;
      }
      out.cabinetBy = by;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * 비동기 일을 하나씩 차례로(설정 파일 읽기→합치기→쓰기가 겹치면 먼저 쓴 값이 지워진다 — 워크스페이스 목록과
 * Cabinet 창 상태가 동시에 저장될 때). 앞 일이 실패해도 다음 일은 한다.
 */
export function serialize<A extends unknown[], R>(fn: (...a: A) => Promise<R>): (...a: A) => Promise<R> {
  let last: Promise<unknown> = Promise.resolve();
  return (...a: A) => {
    const run = last.then(
      () => fn(...a),
      () => fn(...a),
    );
    last = run.catch(() => undefined);
    return run;
  };
}

/** 지금 config.json 글에 바꿀 값만 합친 새 글 — 다른 키는 그대로 둔다(improve-1027v5-spec 4-2) */
export function mergeConfigJson(raw: string | null, patch: Partial<AppConfig>): string {
  let base: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      base = parsed as Record<string, unknown>;
  } catch {
    // 깨진 파일이면 새로 쓴다
  }
  return JSON.stringify({ ...base, ...patch }, null, 2);
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
    return kind === "pdf"
      ? CABI.onlyPdf
      : kind === "image"
        ? STR.note.onlyImage
        : kind === "xlsx"
          ? STR.export.onlyXlsx
          : STR.mdExport.onlyMd;
  if (kind === "markdownImage" && !baseName(dirOf(path)).toLowerCase().endsWith(MD_IMAGE_DIR_SUFFIX))
    return STR.mdExport.onlyMd;
  if (norm(dirOf(path)) === `${norm(dataDir)}\\backups`) return STR.export.notBackups;
  return null;
}

/**
 * 동기화 폴더 판정 공통 규칙(OneDrive — 맥은 iCloud·Google Drive·Dropbox도, macos-spec 3-3).
 * 동기화가 SQLite 파일을 반쯤 쓴 채 올리거나 충돌 사본을 만들 수 있어 같은 경고를 낸다
 */
export function isOneDriveLike(path: string, roots: string[]): boolean {
  const p = path.replace(/\//g, "\\").toLowerCase();
  return (
    roots.some((r) => r && p.startsWith(r.replace(/\//g, "\\").toLowerCase())) ||
    /\\onedrive(\\|$| - )/.test(p) ||
    // 맥: ~/Library/CloudStorage/(OneDrive-…·GoogleDrive-…·Dropbox…) · ~/Library/Mobile Documents/(iCloud Drive) · ~/Dropbox
    /^\\users\\[^\\]+\\(library\\cloudstorage|library\\mobile documents|dropbox)(\\|$)/.test(p)
  );
}

/** config.json `cabinet` 읽기 — 모르는 값은 버린다 */
export function parseCabinetConfig(v: unknown): CabinetConfig | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { open?: unknown; windows?: unknown };
  const windows = Array.isArray(o.windows)
    ? o.windows
        .filter(
          (w): w is { id: string; sub: string } =>
            !!w &&
            typeof w === "object" &&
            typeof (w as { id?: unknown }).id === "string" &&
            typeof (w as { sub?: unknown }).sub === "string",
        )
        .slice(0, 20)
        .map((w) => ({ id: w.id, sub: w.sub }))
    : [];
  return { open: o.open === true, windows };
}
