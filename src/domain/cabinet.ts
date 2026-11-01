// Cabinet — 자주 쓰는 작업 폴더·링크(features-1102-spec F5). 순수 함수만(UI·저장소·플랫폼 import 금지).
// 앱은 폴더를 읽기·열기만 하고(지우기·옮기기 없음), 링크는 OS 기본 브라우저에 넘길 뿐 접속하지 않는다(CLAUDE.md 4-1).
import { isOpenableUrl } from "./links";

export type CabinetKind = "folder" | "link";
export const CABINET_TITLE_MAX = 200;
export const CABINET_TARGET_MAX = 2048;

export interface CabinetItem {
  id: string;
  kind: CabinetKind;
  title: string;
  /** 폴더 = 경로, 링크 = http/https 주소 */
  target: string;
  sortOrder: number;
}

/** 업무 또는 업무 진행 항목 연결(둘 중 하나) */
export interface CabinetLink {
  id: string;
  itemId: string;
  categoryId: string | null;
  entryId: string | null;
  /** 항목 연결이면 그 항목의 날짜·글·업무(목록 "연결: 10/21 설계안 팀 리뷰" 표시용) */
  entry?: { date: string; text: string; categoryId: string } | null;
}

/** 등록·연결 고칠 때 넘기는 연결 하나 */
export type CabinetLinkDraft = { categoryId: string } | { entryId: string };

export type CabinetFilter = "all" | CabinetKind;

/** 폴더 창 목록 한 줄(Rust `cabinet_list`) */
export interface FsEntry {
  name: string;
  dir: boolean;
  size: number | null;
  /** 수정한 시각(ms) */
  modified: number | null;
  /** 숨김·시스템 파일(기본 숨김) */
  hidden: boolean;
}

// ── 경로 ─────────────────────────────────────────────

/** 탐색기 [경로로 복사]의 따옴표·끝 구분자를 걷어 낸다(드라이브 뿌리 `C:\`는 그대로) */
export function normalizeFolderPath(raw: string): string {
  let p = raw
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .trim();
  if (/^[A-Za-z]:[\\/]?$/.test(p)) return `${p.slice(0, 2)}\\`;
  p = p.replace(/[\\/]+$/, "");
  return p;
}

/** 등록할 수 있는 절대 경로인가 — `X:\…`, UNC `\\server\share…`, 브라우저 모드 `/…`. `..` 조각은 거부 */
export function isFolderPathLike(raw: string): boolean {
  const p = normalizeFolderPath(raw);
  if (!p || p.length > CABINET_TARGET_MAX || [...p].some((c) => c.charCodeAt(0) < 32)) return false;
  if (p.split(/[\\/]/).some((s) => s === "..")) return false;
  return /^[A-Za-z]:\\/.test(p) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(p) || p.startsWith("/");
}

const sepOf = (path: string) => (path.includes("\\") ? "\\" : "/");

/** 경로 잇기 — 뿌리의 구분자를 따른다 */
export function joinPath(root: string, ...names: string[]): string {
  const sep = sepOf(root);
  return [root.replace(/[\\/]+$/, ""), ...names.map((n) => n.replace(/^[\\/]+|[\\/]+$/g, ""))]
    .filter((s, i) => i === 0 || s)
    .join(sep);
}

/** 경로의 마지막 이름(폴더 기본 제목). `C:\` → `C:`, `\\server\share` → `share` */
export function folderTitle(path: string): string {
  const p = normalizeFolderPath(path).replace(/[\\/]+$/, "");
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? p;
}

/** 뿌리 아래 상대 조각(`root` 밖이면 빈 배열) — 폴더 창 경로 띠 */
export function relSegments(root: string, path: string): string[] {
  const r = root.replace(/[\\/]+$/, "");
  const lower = (s: string) => s.replace(/\//g, "\\").toLowerCase();
  if (lower(path) === lower(r)) return [];
  if (!lower(path).startsWith(`${lower(r)}\\`)) return [];
  return path
    .slice(r.length + 1)
    .split(/[\\/]/)
    .filter(Boolean);
}

/** 한 단계 위(뿌리에서는 그대로) */
export function parentWithin(root: string, path: string): string {
  const segs = relSegments(root, path);
  return segs.length ? joinPath(root, ...segs.slice(0, -1)) : root;
}

// ── 링크 ─────────────────────────────────────────────

/** 주소로 만든 기본 이름: `wiki.example.com › batch-ops` (앱은 사이트에 접속하지 않는다) */
export function linkTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const last = u.pathname.split("/").filter(Boolean).at(-1);
    let seg = last ?? "";
    try {
      seg = decodeURIComponent(seg);
    } catch {
      // 잘못된 % 표기는 그대로
    }
    seg = seg.replace(/\.(html?|aspx?|php)$/i, "");
    return (seg ? `${host} › ${seg}` : host).slice(0, CABINET_TITLE_MAX);
  } catch {
    return url.slice(0, CABINET_TITLE_MAX);
  }
}

/** 화면에 보일 짧은 주소(`https://` 뺌) */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

const decodeEntities = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** HTML 조각의 첫 링크(브라우저 끌어 놓기 `text/html`·Edge [링크 복사] 친숙한 형식) */
export function firstAnchor(html: string): { url: string; title: string } | null {
  const m = /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/i.exec(html);
  if (!m) return null;
  const url = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return { url, title: decodeEntities(m[5] ?? "") };
}

/** 끌어 놓기·붙여 넣기 자료(브라우저가 함께 주는 것만) */
export interface LinkTransfer {
  uriList?: string;
  /** Firefox `text/x-moz-url`: "주소\n제목" */
  mozUrl?: string;
  html?: string;
  plain?: string;
}

/**
 * 끌어 놓은 링크의 주소·제목. 제목은 브라우저가 함께 준 것(x-moz-url 제목 → HTML 링크 글자) — 없으면 주소로 만든 이름.
 * 링크 글자가 주소 그대로면 제목이 없는 것으로 본다. http/https가 아니면 null.
 */
export function parseLinkTransfer(
  t: LinkTransfer,
): { url: string; title: string; titleFromBrowser: boolean } | null {
  const fromUri = (t.uriList ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith("#"));
  const [mozUrl, mozTitle] = (t.mozUrl ?? "").split(/\r?\n/).map((s) => s.trim());
  const anchor = t.html ? firstAnchor(t.html) : null;
  const plain = (t.plain ?? "").trim().split(/\s+/)[0] ?? "";
  const url = [fromUri, mozUrl, anchor?.url, plain].find((u) => u && isOpenableUrl(u));
  if (!url) return null;
  const candidates = [mozUrl === url ? mozTitle : "", anchor && anchor.url === url ? anchor.title : ""];
  const title = candidates
    .map((s) => (s ?? "").trim())
    .find((s) => s && s !== url && shortUrl(s) !== shortUrl(url));
  return title
    ? { url, title: title.slice(0, CABINET_TITLE_MAX), titleFromBrowser: true }
    : { url, title: linkTitleFromUrl(url), titleFromBrowser: false };
}

// ── 묶음·정렬 ────────────────────────────────────────

/** 항목이 속하는 업무 id들(업무 연결 + 항목 연결의 업무), 순서 유지·중복 없음 */
export function itemCategories(itemId: string, links: CabinetLink[]): string[] {
  const out: string[] = [];
  for (const l of links) {
    if (l.itemId !== itemId) continue;
    const c = l.categoryId ?? l.entry?.categoryId ?? null;
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

export const UNLINKED = "__none__";

/** 업무별 묶음(보드 순서) + 연결 없음. 여러 업무에 연결된 것은 각 묶음에 보인다 */
export function groupCabinet(
  items: CabinetItem[],
  links: CabinetLink[],
  categoryOrder: string[],
): { key: string; itemIds: string[] }[] {
  const by = new Map<string, string[]>();
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const it of sorted) {
    const cats = itemCategories(it.id, links).filter((c) => categoryOrder.includes(c));
    for (const k of cats.length ? cats : [UNLINKED]) by.set(k, [...(by.get(k) ?? []), it.id]);
  }
  const keys = [...categoryOrder.filter((c) => by.has(c)), ...(by.has(UNLINKED) ? [UNLINKED] : [])];
  return keys.map((key) => ({ key, itemIds: by.get(key)! }));
}

export function countKinds(items: CabinetItem[]): Record<CabinetFilter, number> {
  return {
    all: items.length,
    folder: items.filter((i) => i.kind === "folder").length,
    link: items.filter((i) => i.kind === "link").length,
  };
}

export type EntrySortKey = "name" | "modified" | "size";

/** 폴더 창 정렬: 폴더 먼저, 그다음 고른 기준(이름은 한국어 자연 순서) */
export function sortEntries(entries: FsEntry[], key: EntrySortKey, asc: boolean): FsEntry[] {
  const coll = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
  return [...entries].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    let c = 0;
    if (key === "modified") c = (a.modified ?? 0) - (b.modified ?? 0);
    else if (key === "size") c = (a.size ?? -1) - (b.size ?? -1);
    if (c === 0) c = coll.compare(a.name, b.name);
    return asc ? c : -c;
  });
}

export type FileKind = "folder" | "sheet" | "doc" | "slide" | "pdf" | "image" | "text" | "archive" | "other";

export function fileKind(e: Pick<FsEntry, "name" | "dir">): FileKind {
  if (e.dir) return "folder";
  const ext = /\.([^.]+)$/.exec(e.name)?.[1]?.toLowerCase() ?? "";
  if (["xlsx", "xls", "xlsm", "csv"].includes(ext)) return "sheet";
  if (["docx", "doc", "hwp", "hwpx", "rtf", "odt"].includes(ext)) return "doc";
  if (["pptx", "ppt"].includes(ext)) return "slide";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  if (["txt", "md", "log", "sql", "json", "xml", "yml", "yaml", "ini", "py", "js", "ts"].includes(ext))
    return "text";
  if (["zip", "7z", "rar", "tar", "gz"].includes(ext)) return "archive";
  return "other";
}

/** 크기: 1 KB 단위 반올림(탐색기처럼), 1 MB 이상은 소수 한 자리 */
export function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024)).toLocaleString("ko-KR")} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** 수정한 날짜: 올해면 `10/21 17:20`, 아니면 `2025-03-02` */
export function formatModified(ms: number | null, now: Date): string {
  if (ms == null) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() === now.getFullYear()
    ? `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 제목 정리(앞뒤 공백·줄바꿈 → 한 줄, 200자) */
export function normalizeCabinetTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, CABINET_TITLE_MAX);
}

// ── 2026-11-02 개선(improve-1102-spec C2·C4·C5) ──────

export const ALL_GROUP = "__all__";

export interface CabinetGroup {
  key: string;
  itemIds: string[];
  /** 종료된 업무(연결된 것이 있을 때만 보인다) */
  ended?: boolean;
}

/**
 * 왼쪽 '업무별' 목록: 맨 위 전체 → 진행 중 업무 전부(0개도, 보드 순서) → 종료된 업무(연결이 있을 때만) → 연결 없음(있을 때만)
 */
export function cabinetGroups(
  items: CabinetItem[],
  links: CabinetLink[],
  categoryOrder: string[],
  activeIds: string[],
): CabinetGroup[] {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const by = new Map<string, string[]>();
  const unlinked: string[] = [];
  for (const it of sorted) {
    const cats = itemCategories(it.id, links).filter((c) => categoryOrder.includes(c));
    if (!cats.length) unlinked.push(it.id);
    for (const c of cats) by.set(c, [...(by.get(c) ?? []), it.id]);
  }
  const out: CabinetGroup[] = [{ key: ALL_GROUP, itemIds: sorted.map((i) => i.id) }];
  for (const c of categoryOrder) {
    const active = activeIds.includes(c);
    if (active) out.push({ key: c, itemIds: by.get(c) ?? [] });
    else if (by.has(c)) out.push({ key: c, itemIds: by.get(c)!, ended: true });
  }
  if (unlinked.length) out.push({ key: UNLINKED, itemIds: unlinked });
  return out;
}

/** 순서 바꾸기: `id`를 `beforeId` 앞(null이면 `afterId` 뒤, 둘 다 없으면 맨 끝)으로 */
export function moveInOrder(
  order: string[],
  id: string,
  target: { beforeId?: string | null; afterId?: string | null },
): string[] {
  const rest = order.filter((x) => x !== id);
  if (!order.includes(id)) return order;
  let at = rest.length;
  if (target.beforeId && rest.includes(target.beforeId)) at = rest.indexOf(target.beforeId);
  else if (target.afterId && rest.includes(target.afterId)) at = rest.indexOf(target.afterId) + 1;
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** 인터넷 바로 가기(`*.url`) 내용의 주소 — 브라우저(크롬)가 주소 아이콘을 끌 때 함께 넘긴다 */
export function parseUrlShortcut(text: string): string | null {
  const m = /^\s*URL\s*=\s*(\S+)\s*$/im.exec(text);
  return m && isOpenableUrl(m[1]!) ? m[1]! : null;
}

/** `제목.url` → 제목 */
export const urlShortcutTitle = (fileName: string) => normalizeCabinetTitle(fileName.replace(/\.url$/i, ""));

export const isUrlShortcutName = (name: string) => /\.url$/i.test(name);
