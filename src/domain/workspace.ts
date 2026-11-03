// 워크스페이스(multi-board-spec): 공간마다 폴더·일지 파일 1개. 이 모듈은 목록·기본값·추천 규칙만 다루는 순수 함수다.
// 정본 이름·색·아이콘은 각 일지의 설정(settings.workspace), 이 PC 설정(config.json workspaces)은 목록을 빨리 그리는 사본.
import { CATEGORY_COLOR_KEYS, type CategoryColorKey } from "../shared/palette";

/** 모노그램 아이콘(생산성 도구 이모지를 한 색 선 그림으로) — 그림은 ui/common/workspaceIcons.tsx */
export const WORKSPACE_ICONS = [
  "briefcase",
  "folder",
  "calendar",
  "clipboard",
  "memo",
  "pencil",
  "notebook",
  "books",
  "bulb",
  "chartUp",
  "chartBar",
  "pin",
  "paperclip",
  "laptop",
  "envelope",
  "package",
  "tag",
  "lock",
  "key",
  "wrench",
  "search",
  "alarm",
  "hourglass",
  "cardIndex",
  "scissors",
  "ruler",
  "moneyBag",
  "creditCard",
] as const;
export type WorkspaceIcon = (typeof WORKSPACE_ICONS)[number];

export const PURPOSES = ["work", "life", "study", "side", "custom"] as const;
export type WorkspacePurpose = (typeof PURPOSES)[number];

/** 용도별 기본 아이콘·첫 업무 추천(spec 4절 3단계) */
export const PURPOSE_PRESET: Record<WorkspacePurpose, { icon: WorkspaceIcon; categories: string[] }> = {
  work: { icon: "briefcase", categories: [] },
  life: { icon: "notebook", categories: ["건강·운동", "공부", "집안일", "재테크"] },
  study: { icon: "books", categories: ["강의", "과제", "독서"] },
  side: { icon: "bulb", categories: ["기획", "개발", "홍보"] },
  custom: { icon: "folder", categories: [] },
};

/** 무기록 알림을 기본으로 끄는 용도(D9) */
export const QUIET_PURPOSES: readonly WorkspacePurpose[] = ["life", "study"];

/** 일지 안에 두는 공간 정보(settings.workspace) */
export interface WorkspaceMeta {
  name: string;
  color: CategoryColorKey;
  icon: WorkspaceIcon;
  /** 마지막으로 이름·색·아이콘을 고친 시각(ms) — 이 PC 사본과 어느 쪽이 새것인지 */
  updatedAt: number;
}

/** 이 PC 목록의 한 줄(config.json workspaces[]) */
export interface WorkspaceEntry extends WorkspaceMeta {
  dir: string;
  /** 마지막으로 연 날 `YYYY-MM-DD` */
  lastOpened?: string;
  /** 보조 백업 위치 아래 하위 폴더 이름(없으면 보조 위치 바로 아래 — 처음부터 쓰던 공간) */
  mirrorSub?: string;
}

export const NAME_MAX = 24;
export const MAX_SHORTCUT = 9;

/** 처음 쓰던 일지(목록이 없을 때)의 기본값 — 직장용 */
export const FIRST_WORKSPACE: Omit<WorkspaceMeta, "updatedAt"> = {
  name: "회사",
  color: "c1",
  icon: "briefcase",
};

export const cleanName = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, NAME_MAX);

export function isIcon(v: unknown): v is WorkspaceIcon {
  return typeof v === "string" && (WORKSPACE_ICONS as readonly string[]).includes(v);
}
export function isColor(v: unknown): v is CategoryColorKey {
  return typeof v === "string" && (CATEGORY_COLOR_KEYS as readonly string[]).includes(v);
}

/** 저장된 값(어떤 모양이든) → 공간 정보. 못 쓰는 값은 null */
export function parseMeta(v: unknown): WorkspaceMeta | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const name = typeof o.name === "string" ? cleanName(o.name) : "";
  if (!name) return null;
  return {
    name,
    color: isColor(o.color) ? o.color : FIRST_WORKSPACE.color,
    icon: isIcon(o.icon) ? o.icon : FIRST_WORKSPACE.icon,
    updatedAt: typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt) ? o.updatedAt : 0,
  };
}

/** 경로 비교용(윈도우는 대소문자·구분자 차이를 같게) */
export function sameDir(a: string, b: string): boolean {
  const n = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return n(a) === n(b);
}

/**
 * config.json에서 목록을 읽는다. 목록이 없으면(예전 판에서 올라온 사용자) 지금 폴더 하나로 만든다.
 * 같은 폴더가 두 번 있으면 앞의 것만. 지금 폴더(dataDir)가 목록에 없으면 맨 앞에 넣는다.
 */
export function readEntries(config: { dataDir: string; workspaces?: unknown }): WorkspaceEntry[] {
  const out: WorkspaceEntry[] = [];
  if (Array.isArray(config.workspaces)) {
    for (const raw of config.workspaces) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      if (typeof o.dir !== "string" || !o.dir || out.some((e) => sameDir(e.dir, o.dir as string))) continue;
      const meta = parseMeta(o) ?? { ...FIRST_WORKSPACE, name: baseName(o.dir), updatedAt: 0 };
      out.push({
        ...meta,
        dir: o.dir,
        ...(typeof o.lastOpened === "string" ? { lastOpened: o.lastOpened } : {}),
        ...(typeof o.mirrorSub === "string" && o.mirrorSub ? { mirrorSub: o.mirrorSub } : {}),
      });
    }
  }
  if (config.dataDir && !out.some((e) => sameDir(e.dir, config.dataDir)))
    out.unshift({ ...FIRST_WORKSPACE, updatedAt: 0, dir: config.dataDir });
  return out;
}

/** 일지의 공간 정보와 이 PC 사본 중 새것 — 일지에 없으면 사본, 사본이 더 새것이면 사본(다른 공간에서 고친 이름) */
export function reconcile(
  journal: WorkspaceMeta | null,
  entry: WorkspaceEntry,
): { meta: WorkspaceMeta; writeJournal: boolean } {
  const fromEntry: WorkspaceMeta = {
    name: entry.name,
    color: entry.color,
    icon: entry.icon,
    updatedAt: entry.updatedAt,
  };
  if (!journal) return { meta: fromEntry, writeJournal: true };
  if (entry.updatedAt > journal.updatedAt) return { meta: fromEntry, writeJournal: true };
  return { meta: journal, writeJournal: false };
}

/** 목록에 한 줄 넣기·바꾸기(같은 폴더면 바꿈, 없으면 끝에) */
export function upsertEntry(list: WorkspaceEntry[], entry: WorkspaceEntry): WorkspaceEntry[] {
  const i = list.findIndex((e) => sameDir(e.dir, entry.dir));
  if (i < 0) return [...list, entry];
  const next = list.slice();
  next[i] = { ...list[i]!, ...entry };
  return next;
}

/** 목록에서 빼기(D10 — 이 PC 목록에서만). 지금 연 공간·마지막 하나는 뺄 수 없음 */
export function canRemove(list: WorkspaceEntry[], dir: string, current: string | null): boolean {
  if (list.length <= 1) return false;
  if (current && sameDir(dir, current)) return false;
  return list.some((e) => sameDir(e.dir, dir));
}

export function removeEntry(list: WorkspaceEntry[], dir: string): WorkspaceEntry[] {
  return list.filter((e) => !sameDir(e.dir, dir));
}

/** 끌어서 순서 바꾸기 — from 자리의 줄을 to 자리로 */
export function moveEntry(list: WorkspaceEntry[], from: number, to: number): WorkspaceEntry[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it!);
  return next;
}

/** 경로의 마지막 이름 */
export function baseName(path: string): string {
  const p = path.replace(/[\\/]+$/, "");
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return p.slice(i + 1) || p;
}

/** 폴더 이름에 못 쓰는 글자를 뺀다(윈도우·맥 공통) */
export function folderSafe(name: string): string {
  return cleanName(name)
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[. ]+$/, "")
    .trim();
}

/** 새 공간 추천 폴더(spec 4절 2단계): 지금 공간 폴더 옆 `<지금 폴더 이름>-<이름>`. 이미 쓰는 폴더면 `-2`, `-3`… */
export function suggestDir(currentDir: string, name: string, taken: string[]): string {
  const p = currentDir.replace(/[\\/]+$/, "");
  const sep = p.includes("\\") ? "\\" : "/";
  const i = p.lastIndexOf(sep);
  const parent = i > 0 ? p.slice(0, i) : p;
  const stem = (i >= 0 ? p.slice(i + 1) : p).replace(/-[^-]*$/, "") || "WorkJourney";
  const safe = folderSafe(name) || "새 워크스페이스";
  const base = `${parent}${sep}${stem}-${safe}`;
  let dir = base;
  for (let n = 2; taken.some((t) => sameDir(t, dir)); n++) dir = `${base}-${n}`;
  return dir;
}

/** 다음 공간에 줄 색(이미 쓰는 색을 피해서) */
export function nextWorkspaceColor(list: WorkspaceEntry[]): CategoryColorKey {
  const used = new Set(list.map((e) => e.color));
  return CATEGORY_COLOR_KEYS.find((c) => !used.has(c)) ?? CATEGORY_COLOR_KEYS[list.length % 8]!;
}

/** n번째(1부터) 공간 — 단축키 Ctrl+Alt+n */
export function entryAt(list: WorkspaceEntry[], n: number): WorkspaceEntry | null {
  return n >= 1 && n <= MAX_SHORTCUT ? (list[n - 1] ?? null) : null;
}
