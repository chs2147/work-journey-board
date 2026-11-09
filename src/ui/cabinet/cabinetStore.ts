import { closeCabiWindows, startCabiHost } from "./cabiService";
// Cabinet 화면 상태(features-1102-spec F5). 등록·연결은 일지(JournalRepository), 열린 창·하위 위치는 이 PC 설정(config.json `cabinet`).
// 폴더 창: 실앱 = 별도 OS 창(Platform.folderWindows), 브라우저 모드 = 앱 안 떠 있는 창(같은 FolderView).
import { create } from "zustand";
import {
  ALL_GROUP,
  cabinetGroups,
  folderTitle,
  isFolderPathLike,
  isUrlShortcutName,
  itemCategories,
  linkTitleFromUrl,
  moveInOrder,
  parseLinkTransfer,
  parseUrlShortcut,
  UNLINKED,
  urlShortcutTitle,
  type CabinetFilter,
  type CabinetItem,
  type CabinetLink,
  type CabinetLinkDraft,
  type LinkTransfer,
} from "../../domain/cabinet";
import { shortDateLabel } from "../../domain/week";
import type { Category } from "../../domain/types";
import { baseName } from "../../platform";
import type { CabinetConfig, CabinetFocus, CabinetWindowBridge, FolderWindowSpec } from "../../platform";
import type { JournalRepository } from "../../data/repository";
import { resolveTheme } from "../../shared/theme";
import { STR } from "../../shared/strings";
import { reportError, toast, useBoard } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import { openLink } from "../common/openLink";

export interface LinkDialogState {
  mode: "new" | "edit";
  itemId?: string;
  url: string;
  title: string;
  titleFromBrowser: boolean;
  links: CabinetLinkDraft[];
  fromDrop: boolean;
}

export interface CabinetState {
  open: boolean;
  items: CabinetItem[];
  links: CabinetLink[];
  categories: Category[];
  /** 진행 중(종료 안 된) 업무 id(improve-1102-spec C2) */
  activeIds: string[];
  cabiCounts: Record<string, number>;
  cabiBoardIds: string[];
  /** 보드가 보는 주의 본 항목(항목 연결 고르기) — 메인 창이 채워 Cabinet 창에도 보낸다 */
  weekId: string;
  weekEntries: WeekEntry[];
  /** 왼쪽에서 고른 묶음(ALL_GROUP·업무 id·UNLINKED) */
  group: string | null;
  filter: CabinetFilter;
  /** 이름 고치는 중인 항목 */
  renaming: string | null;
  linkDialog: LinkDialogState | null;
  /** 연결 고치기 창 */
  linksFor: string | null;
  /** 열린 폴더 창(실앱 = OS 창 목록 사본, 브라우저 = 앱 안 창) — 하위 위치까지 */
  folders: { id: string; sub: string }[];
  /** 잠깐 강조(검색 결과에서 왔을 때) */
  flash: string | null;
  /** 찾을 수 없는 등록 폴더(improve-1102v7 K4) — 이 창에서 확인한 결과 */
  missing: string[];
  checking: boolean;
}

export interface WeekEntry {
  id: string;
  date: string;
  text: string;
  categoryId: string;
}

export const useCabinet = create<CabinetState>(() => ({
  open: false,
  items: [],
  links: [],
  categories: [],
  activeIds: [],
  cabiCounts: {},
  cabiBoardIds: [],
  weekId: "",
  weekEntries: [],
  group: null,
  filter: "all",
  renaming: null,
  linkDialog: null,
  linksFor: null,
  folders: [],
  flash: null,
  missing: [],
  checking: false,
}));

const app = () => useAppStore.getState();

/** Cabinet이 쓰는 저장소 메서드(별도 창에서는 메인 창에 대신 부탁 — 허용 목록) */
const REPO_METHODS = [
  "addCabinetItems",
  "updateCabinetItem",
  "setCabinetLinks",
  "removeCabinetItem",
  "restoreCabinetItem",
  "reorderCabinet",
] as const;
type CabinetRepo = Pick<JournalRepository, (typeof REPO_METHODS)[number]>;

/** 실앱 Cabinet 별도 창(?win=cabinet)이면 메인 창으로 가는 다리 — 이 창은 일지를 열지 않는다(improve-1102-spec C1) */
let remote: CabinetWindowBridge | null = null;
export function setCabinetRemote(bridge: CabinetWindowBridge) {
  remote = bridge;
}
export const isCabinetRemote = () => remote !== null;

const remoteRepo = (): CabinetRepo =>
  Object.fromEntries(
    REPO_METHODS.map((m) => [m, (...args: unknown[]) => remote!.call("repo", [m, ...args])]),
  ) as unknown as CabinetRepo;

const repo = (): CabinetRepo | null => {
  if (remote) return remoteRepo();
  const j = app().journal;
  return j.state === "ready" ? j.repo : null;
};
const localRepo = () => {
  const j = app().journal;
  return j.state === "ready" ? j.repo : null;
};

/** 설정 저장(열린 창 상태) — 잦은 이동은 묶어서 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let exiting = false;
let listening = false;
function persist() {
  if (exiting || remote) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const { open, folders } = useCabinet.getState();
    const cabinet: CabinetConfig = { open, windows: folders };
    void app()
      .platform?.saveConfig({ cabinet })
      .catch(() => undefined);
  }, 300);
}

export interface CabinetSnapshot {
  items: CabinetItem[];
  links: CabinetLink[];
  categories: Category[];
  activeIds: string[];
  cabiCounts: Record<string, number>;
  cabiBoardIds: string[];
  weekId: string;
  weekEntries: WeekEntry[];
  folders: { id: string; sub: string }[];
}

export function snapshot(): CabinetSnapshot {
  const { items, links, categories, activeIds, cabiCounts, cabiBoardIds, weekId, weekEntries, folders } =
    useCabinet.getState();
  return { items, links, categories, activeIds, cabiCounts, cabiBoardIds, weekId, weekEntries, folders };
}

export function applySnapshot(snap: unknown) {
  if (!snap || typeof snap !== "object") return;
  useCabinet.setState(snap as CabinetSnapshot);
}

export async function loadCabinet() {
  if (remote) return applySnapshot(await remote.call("snapshot", []));
  const r = localRepo();
  if (!r) return;
  const [{ items, links }, { categories, periods }, notes, boards] = await Promise.all([
    r.listCabinet(),
    r.listCategories(),
    r.cabi.listNotes(),
    r.cabi.listBoards(),
  ]);
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
  const activeIds = [...new Set(periods.filter((p) => p.endDate === null).map((p) => p.categoryId))];
  const cabiCounts: Record<string, number> = {};
  for (const d of [...notes, ...boards]) cabiCounts[d.categoryId] = (cabiCounts[d.categoryId] ?? 0) + 1;
  useCabinet.setState({
    items,
    links,
    categories: sorted,
    activeIds,
    cabiCounts,
    cabiBoardIds: boards.map((b) => b.categoryId),
  });
  await app()
    .platform?.cabinetSetRoots(items.filter((i) => i.kind === "folder").map((i) => i.target))
    .catch(() => undefined);
  // 지워진 항목의 폴더 창은 닫는다
  const ids = new Set(items.map((i) => i.id));
  const gone = useCabinet.getState().folders.filter((f) => !ids.has(f.id));
  if (gone.length) useCabinet.setState((s) => ({ folders: s.folders.filter((f) => ids.has(f.id)) }));
}

export function groupsOf(
  s: Pick<CabinetState, "items" | "links" | "categories" | "activeIds"> & {
    cabiCounts?: Record<string, number>;
  },
) {
  const out = cabinetGroups(
    s.items,
    s.links,
    s.categories.map((c) => c.id),
    s.activeIds,
  );
  for (const c of s.categories)
    if (s.cabiCounts?.[c.id] && !out.some((g) => g.key === c.id))
      out.push({ key: c.id, itemIds: [], ended: !s.activeIds.includes(c.id) });
  return out;
}

/** 지금 보일 묶음 — 고른 게 없거나 사라졌으면 '전체' */
export function currentGroup(s: CabinetState): string {
  const gs = groupsOf(s);
  if (s.group && gs.some((g) => g.key === s.group)) return s.group;
  return ALL_GROUP;
}

/** 고를 업무·강조할 항목 적용(항목이면 '전체'에서 그 줄을 잠깐 강조) */
export function applyFocus(opts: CabinetFocus) {
  if (opts.itemId) {
    const id = opts.itemId;
    useCabinet.setState({ group: ALL_GROUP, filter: "all", flash: id });
    setTimeout(() => {
      if (useCabinet.getState().flash === id) useCabinet.setState({ flash: null });
    }, 1600);
  } else if (opts.categoryId) useCabinet.setState({ group: opts.categoryId, filter: "all" });
}

export async function openCabinet(opts: CabinetFocus = {}) {
  if (remote) return applyFocus(opts);
  const bridge = app().platform?.cabinetWindow;
  useCabinet.setState({ open: true });
  persist();
  if (bridge) {
    // 실앱: 별도 OS 창 — 자료는 그 창이 켜지면서 메인 창에 묻는다
    await bridge
      .open(opts.categoryId || opts.itemId ? opts : null, resolveTheme(app().theme))
      .catch(reportError);
    return;
  }
  await loadCabinet();
  applyFocus(opts);
}

export function closeCabinet() {
  if (remote) {
    void remote.closeSelf();
    return;
  }
  useCabinet.setState({ open: false, renaming: null, linkDialog: null, linksFor: null });
  persist();
  void app().platform?.cabinetWindow?.close();
}

export function toggleCabinet() {
  if (remote || useCabinet.getState().open) closeCabinet();
  else void openCabinet();
}

/** 묶음에 맞는 기본 연결(업무 묶음이면 그 업무, 전체·연결 없음이면 없음) */
function defaultLinks(): CabinetLinkDraft[] {
  const g = currentGroup(useCabinet.getState());
  return g !== ALL_GROUP && g !== UNLINKED ? [{ categoryId: g }] : [];
}

const draftsOf = (itemId: string): CabinetLinkDraft[] =>
  useCabinet
    .getState()
    .links.filter((l) => l.itemId === itemId)
    .map((l) => (l.categoryId ? { categoryId: l.categoryId } : { entryId: l.entryId! }));

/** 줄을 왼쪽 업무에 끌어 놓기 = 그 업무 연결 더하기(기존 연결 유지, improve-1102-spec C3) */
export async function addItemToCategory(itemId: string, categoryId: string) {
  const s = useCabinet.getState();
  const it = s.items.find((i) => i.id === itemId);
  const cat = s.categories.find((c) => c.id === categoryId);
  const r = repo();
  if (!it || !cat || !r) return;
  const drafts = draftsOf(itemId);
  if (drafts.some((d) => "categoryId" in d && d.categoryId === categoryId))
    return toast(STR.cabinet.alreadyIn(cat.name));
  try {
    await r.setCabinetLinks(itemId, [...drafts, { categoryId }]);
    await loadCabinet();
    toast(STR.cabinet.linkedToCat(it.title, cat.name));
  } catch (e) {
    reportError(e);
  }
}

/** 줄 끌어 순서 바꾸기 — 지금 보는 묶음 안의 앞뒤 관계를 전체 순서에 반영(C4) */
export async function reorderItem(id: string, target: { beforeId?: string | null; afterId?: string | null }) {
  const r = repo();
  if (!r) return;
  const order = [...useCabinet.getState().items].sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.id);
  const next = moveInOrder(order, id, target);
  if (next.join() === order.join()) return;
  // 화면을 먼저 바꿔 끌어 놓은 자리가 바로 보이게
  useCabinet.setState((st) => ({
    items: st.items.map((i) => ({ ...i, sortOrder: next.indexOf(i.id) + 1 })),
  }));
  try {
    await r.reorderCabinet(next);
    await loadCabinet();
  } catch (e) {
    reportError(e);
    await loadCabinet();
  }
}

async function addFolderPaths(paths: string[], links = defaultLinks()) {
  const r = repo();
  if (!r) return;
  const ok = paths.filter(isFolderPathLike);
  const bad = paths.filter((x) => !isFolderPathLike(x));
  if (bad.length) toast(STR.cabinet.dropWhy.badPath(bad.join(", ")));
  if (!ok.length) return;
  try {
    const res = await r.addCabinetItems(
      ok.map((p) => ({ kind: "folder" as const, title: folderTitle(p), target: p, links })),
    );
    await loadCabinet();
    const made = res.filter((x) => x.created).length;
    toast(made ? STR.cabinet.added(made) : STR.cabinet.already);
  } catch (e) {
    reportError(e);
  }
}

export async function pickAndAddFolders() {
  const p = app().platform;
  if (!p) return;
  const picked = await p.pickFolders(STR.cabinet.pickTitle);
  if (picked?.length) await addFolderPaths(picked);
}

const transferOf = (dt: DataTransfer): LinkTransfer => ({
  uriList: dt.getData("text/uri-list"),
  mozUrl: dt.getData("text/x-moz-url"),
  html: dt.getData("text/html"),
  plain: dt.getData("text/plain"),
});

/** 끌어 놓은 것이 등록할 만한가(놓기 표시용) */
export function acceptsDrop(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = [...dt.types];
  return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/plain");
}

/**
 * 놓기: 탐색기 폴더(A안 — 경로) 또는 브라우저 링크(improve-1102-spec C5).
 * 크롬은 주소 아이콘을 끌 때 주소와 함께 인터넷 바로 가기 파일(`*.url`)을 넘긴다 — 폴더 경로가 없고 주소가 있으면 링크로 본다.
 */
export async function handleDrop(dt: DataTransfer) {
  const files = [...dt.files];
  const urlFiles = files.filter((f) => isUrlShortcutName(f.name));
  const others = files.filter((f) => !isUrlShortcutName(f.name));
  let link = parseLinkTransfer(transferOf(dt));
  // 맥 WebKit은 폴더만 놓으면 File 목록이 빌 수 있다 — "Files"가 있으면 경로를 물어본다(macos-spec 3-4)
  const filesOnly = !files.length && [...dt.types].includes("Files") && !link;
  if (others.length || filesOnly) {
    // 폴더만 등록 — 바로 가기(.lnk)는 가리키는 폴더로, 아니면 무엇이 왜 안 되는지 이름과 함께(improve-1102v7 K2)
    const p = app().platform;
    const got = (await p?.droppedPaths(others).catch(() => null)) ?? null;
    const dirs: string[] = [];
    const problems: string[] = [];
    const W = STR.cabinet.dropWhy;
    for (const g of got ?? []) {
      const name = baseName(g.path);
      if (g.isDir) dirs.push(g.path);
      else if (/\.lnk$/i.test(g.path)) {
        const target = await p?.resolveShortcut(g.path).catch(() => null);
        const st = target ? await p?.stat(target).catch(() => null) : null;
        if (target && st?.isDir) dirs.push(target);
        else problems.push(W.lnk(name));
      } else if (!g.exists) problems.push(W.missing(name));
      else if (/\.(zip|7z|rar|alz|egg)$/i.test(g.path)) problems.push(W.zip(name));
      else problems.push(W.file(name));
    }
    if (dirs.length) {
      await addFolderPaths(dirs);
      if (problems.length) toast(problems.join(" · "));
      return;
    }
    if (!link && !urlFiles.length)
      return toast(got ? problems.join(" · ") || STR.cabinet.onlyFolders : STR.cabinet.noPath);
  }
  if (urlFiles.length) {
    const f = urlFiles[0]!;
    const fromFile = parseUrlShortcut(await f.text().catch(() => ""));
    const title = urlShortcutTitle(f.name);
    if (!link && fromFile)
      link = { url: fromFile, title: title || linkTitleFromUrl(fromFile), titleFromBrowser: !!title };
    else if (link && !link.titleFromBrowser && title) link = { ...link, title, titleFromBrowser: true };
  }
  if (!link) {
    // 글로 끌어 온 폴더 경로(탐색기 주소창 글 등)
    const plain = dt.getData("text/plain").trim();
    if (isFolderPathLike(plain)) return addFolderPaths([plain]);
    return toast(STR.cabinet.notLink);
  }
  useCabinet.setState({
    linkDialog: {
      mode: "new",
      url: link.url,
      title: link.title,
      titleFromBrowser: link.titleFromBrowser,
      links: defaultLinks(),
      fromDrop: true,
    },
  });
}

export function newLinkDialog() {
  useCabinet.setState({
    linkDialog: {
      mode: "new",
      url: "",
      title: "",
      titleFromBrowser: false,
      links: defaultLinks(),
      fromDrop: false,
    },
  });
}

export function editLinkDialog(id: string) {
  const s = useCabinet.getState();
  const it = s.items.find((i) => i.id === id);
  if (!it || it.kind !== "link") return;
  useCabinet.setState({
    linkDialog: {
      mode: "edit",
      itemId: id,
      url: it.target,
      title: it.title,
      titleFromBrowser: true,
      links: s.links
        .filter((l) => l.itemId === id)
        .map((l) => (l.categoryId ? { categoryId: l.categoryId } : { entryId: l.entryId! })),
      fromDrop: false,
    },
  });
}

export function patchLinkDialog(patch: Partial<LinkDialogState>) {
  const d = useCabinet.getState().linkDialog;
  if (d) useCabinet.setState({ linkDialog: { ...d, ...patch } });
}

export function closeLinkDialog() {
  useCabinet.setState({ linkDialog: null });
}

/** 링크 등록·고치기 저장 — 성공하면 true */
export async function saveLinkDialog(): Promise<boolean> {
  const d = useCabinet.getState().linkDialog;
  const r = repo();
  if (!d || !r) return false;
  try {
    if (d.mode === "new") {
      const res = await r.addCabinetItems([
        { kind: "link", title: d.title, target: d.url.trim(), links: d.links },
      ]);
      toast(res[0]?.created ? STR.cabinet.added(1) : STR.cabinet.already);
    } else if (d.itemId) {
      await r.updateCabinetItem(d.itemId, { title: d.title, target: d.url });
      await r.setCabinetLinks(d.itemId, d.links);
    }
    useCabinet.setState({ linkDialog: null });
    await loadCabinet();
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}

export function startRename(id: string) {
  useCabinet.setState({ renaming: id });
}

export async function finishRename(id: string, title: string | null) {
  useCabinet.setState({ renaming: null });
  const r = repo();
  if (!r || title == null) return;
  const it = useCabinet.getState().items.find((i) => i.id === id);
  if (!it || title.trim() === it.title || !title.trim()) return;
  try {
    await r.updateCabinetItem(id, { title });
    await loadCabinet();
  } catch (e) {
    reportError(e);
  }
}

export async function saveLinks(itemId: string, links: CabinetLinkDraft[]) {
  const r = repo();
  if (!r) return;
  try {
    await r.setCabinetLinks(itemId, links);
    useCabinet.setState({ linksFor: null });
    await loadCabinet();
  } catch (e) {
    reportError(e);
  }
}

export async function removeItem(id: string) {
  const r = repo();
  if (!r) return;
  try {
    const undo = await r.removeCabinetItem(id);
    if (!undo) return;
    await closeFolder(id);
    await loadCabinet();
    toast(STR.cabinet.removed(undo.item.title), {
      label: STR.toast.undo,
      run: () => void r.restoreCabinetItem(undo).then(loadCabinet).catch(reportError),
    });
  } catch (e) {
    reportError(e);
  }
}

export async function copyTarget(id: string) {
  const it = useCabinet.getState().items.find((i) => i.id === id);
  if (!it) return;
  await app().platform?.writeClipboard(it.target);
  toast(STR.cabinet.copied);
}

/** 탐색기에서 열기 = 그 폴더 안으로(상위 폴더에서 선택된 채가 아니라, improve-1102-spec C6) */
export async function revealItem(id: string) {
  const it = useCabinet.getState().items.find((i) => i.id === id);
  if (it?.kind === "folder") await app().platform?.cabinetOpen(it.target).catch(reportError);
}

/** 연결 표시 글(폴더 창 머리·목록) — 업무 이름, 항목이면 "10/21 설계안 팀 리뷰" */
export function linkLabels(
  itemId: string,
  s: Pick<CabinetState, "links" | "categories"> = useCabinet.getState(),
) {
  return s.links
    .filter((l) => l.itemId === itemId)
    .map((l) => {
      if (l.categoryId) return s.categories.find((c) => c.id === l.categoryId)?.name ?? "";
      if (l.entry) return `${shortDateLabel(l.entry.date)} ${l.entry.text.split("\n")[0]}`.slice(0, 60);
      return "";
    })
    .filter(Boolean);
}

/**
 * 등록 폴더가 아직 있는지 확인(improve-1102v7 K4) — 이름 바꾸기·이동·삭제로 사라진 폴더를 표시.
 * manual = [폴더 확인] 단추(결과를 알림), 아니면 열 때·창으로 돌아올 때 조용히
 */
export async function checkFolders(manual = false) {
  const p = app().platform;
  if (!p || useCabinet.getState().checking) return;
  const folders = useCabinet.getState().items.filter((i) => i.kind === "folder");
  useCabinet.setState({ checking: true });
  try {
    const res = await Promise.all(
      folders.map(async (f) => {
        const st = await p.stat(f.target).catch(() => null);
        return st?.exists && st.isDir ? null : f.id;
      }),
    );
    const missing = res.filter((x): x is string => !!x);
    const prev = useCabinet.getState().missing;
    if (missing.join() !== prev.join()) useCabinet.setState({ missing });
    if (manual)
      toast(
        missing.length
          ? STR.cabinet.check.someMissing(folders.length, missing.length)
          : STR.cabinet.check.allOk(folders.length),
      );
  } finally {
    useCabinet.setState({ checking: false });
  }
}

/** 경로 다시 지정 — 폴더를 골라 그 항목의 경로만 바꾼다(제목·연결은 그대로) */
export async function relocateItem(id: string) {
  const p = app().platform;
  const r = repo();
  const it = useCabinet.getState().items.find((i) => i.id === id);
  if (!p || !r || it?.kind !== "folder") return;
  const picked = await p.pickFolder(STR.cabinet.check.relocateTitle(it.title));
  if (!picked) return;
  try {
    await r.updateCabinetItem(id, { target: picked });
    await loadCabinet();
    useCabinet.setState((st) => ({ missing: st.missing.filter((x) => x !== id) }));
    toast(STR.cabinet.check.relocated(it.title));
    void checkFolders();
  } catch (e) {
    reportError(e);
  }
}

/** 항목 열기: 폴더 = 폴더 창, 링크 = 기본 브라우저 */
export async function openItem(id: string) {
  const it = useCabinet.getState().items.find((i) => i.id === id);
  if (!it) return;
  if (it.kind === "folder" && useCabinet.getState().missing.includes(id))
    return toast(STR.cabinet.check.cannotOpen(it.title));
  if (it.kind === "link") return openLink(it.target);
  return openFolder(id);
}

export async function openFolder(id: string, sub?: string) {
  if (remote) {
    await remote.call("openFolder", [id, sub ?? null]).catch(reportError);
    return;
  }
  const s = useCabinet.getState();
  const it = s.items.find((i) => i.id === id && i.kind === "folder");
  if (!it) return;
  const at = sub ?? s.folders.find((f) => f.id === id)?.sub ?? it.target;
  const fw = app().platform?.folderWindows;
  if (!s.folders.some((f) => f.id === id)) useCabinet.setState({ folders: [...s.folders, { id, sub: at }] });
  persist();
  if (fw) {
    const spec: FolderWindowSpec = {
      id,
      root: it.target,
      sub: at,
      title: it.title,
      links: linkLabels(id),
      theme: resolveTheme(app().theme),
    };
    await fw.open(spec).catch(reportError);
  }
}

export function setFolderSub(id: string, sub: string) {
  useCabinet.setState((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, sub } : f)) }));
  persist();
}

export async function closeFolder(id: string) {
  if (remote) {
    await remote.call("closeFolder", [id]).catch(() => undefined);
    return;
  }
  useCabinet.setState((s) => ({ folders: s.folders.filter((f) => f.id !== id) }));
  persist();
}

/** 앱을 켤 때: 이 PC 설정에 적힌 Cabinet 창·폴더 창을 다시 연다 + OS 창 알림 받기 */
export async function restoreCabinet() {
  await startCabiHost();
  const p = app().platform;
  if (!p) return;
  if (!listening) {
    listening = true;
    watchBoard();
    if (p.folderWindows)
      await p.folderWindows.onEvent((e) => {
        if (e.type === "nav") setFolderSub(e.id, e.sub);
        else if (!exiting) void closeFolder(e.id);
      });
    const bridge = p.cabinetWindow;
    if (bridge) {
      bridge.onClosed(() => {
        if (exiting) return;
        useCabinet.setState({ open: false });
        persist();
      });
      await bridge.serve(serveRemote);
      // 메인 창 자료가 바뀌면 Cabinet 창에 보낸다
      useCabinet.subscribe((st, prev) => {
        if (
          st.items !== prev.items ||
          st.links !== prev.links ||
          st.categories !== prev.categories ||
          st.activeIds !== prev.activeIds ||
          st.weekEntries !== prev.weekEntries ||
          st.folders !== prev.folders
        )
          void bridge.sync(snapshot()).catch(() => undefined);
      });
    }
  }
  await loadCabinet();
  const cfg = (await p.loadConfig().catch(() => null))?.cabinet;
  if (!cfg) return;
  if (cfg.open) {
    if (p.cabinetWindow) void openCabinet();
    else useCabinet.setState({ open: true });
  }
  const ids = new Set(useCabinet.getState().items.map((i) => i.id));
  for (const w of cfg.windows) if (ids.has(w.id)) await openFolder(w.id, w.sub);
}

/** 앱을 닫을 때: 열린 창 상태를 저장하고 폴더 창을 닫는다 */
export async function shutdownCabinet() {
  if (saveTimer) clearTimeout(saveTimer);
  const p = app().platform;
  const { open, folders } = useCabinet.getState();
  exiting = true;
  await p?.saveConfig({ cabinet: { open, windows: folders } }).catch(() => undefined);
  await p?.folderWindows?.closeAll().catch(() => undefined);
}

/**
 * 워크스페이스 전환(multi-board-spec 6절): 지금 공간의 창 상태를 돌려주고 Cabinet 창·폴더 창을 닫는다.
 * 다음 공간의 창 상태는 전환 뒤 restoreCabinet이 config.cabinet으로 다시 연다.
 */
export async function suspendCabinet(): Promise<CabinetConfig> {
  await closeCabiWindows();
  if (saveTimer) clearTimeout(saveTimer);
  const p = app().platform;
  const { open, folders } = useCabinet.getState();
  exiting = true;
  try {
    await p?.folderWindows?.closeAll().catch(() => undefined);
    if (open) await p?.cabinetWindow?.close().catch(() => undefined);
  } finally {
    exiting = false;
  }
  useCabinet.setState({ open: false, folders: [] });
  return { open, windows: folders };
}

/** 업무 → 연결된 Cabinet 항목 수(보드 업무 머리 메뉴), 항목 → 연결된 폴더·링크(보드 🗂 표시) */
export function entryLinks(
  entryId: string,
  s: Pick<CabinetState, "links" | "items"> = useCabinet.getState(),
) {
  return s.links.filter((l) => l.entryId === entryId).map((l) => l.itemId);
}

/** Cabinet 창이 부탁한 일을 메인 창(일지의 주인)이 대신 한다 — 허용한 것만(improve-1102-spec C1) */
async function serveRemote(name: string, args: unknown[]): Promise<unknown> {
  if (name === "snapshot") {
    await loadCabinet();
    return snapshot();
  }
  if (name === "repo") {
    const [method, ...rest] = args as [string, ...unknown[]];
    const r = localRepo();
    if (!r || !(REPO_METHODS as readonly string[]).includes(method))
      throw new Error(`허용되지 않은 요청: ${method}`);
    const fn = r[method as (typeof REPO_METHODS)[number]] as (...a: unknown[]) => Promise<unknown>;
    const out = await fn.apply(r, rest);
    await loadCabinet();
    return out ?? null;
  }
  if (name === "openFolder") {
    const [id, sub] = args as [string, string | null];
    await openFolder(id, sub ?? undefined);
    return null;
  }
  if (name === "closeFolder") {
    await closeFolder(args[0] as string);
    return null;
  }
  throw new Error(`알 수 없는 요청: ${name}`);
}

/** 보드가 보는 주의 본 항목(항목 연결 고르기)·업무 변화 따라가기 — 메인 창만 */
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
function watchBoard() {
  const update = () => {
    const view = useBoard.getState().view;
    if (!view) return;
    const weekEntries: WeekEntry[] = [];
    for (const day of view.days)
      for (const vc of view.categories)
        for (const it of view.items[`${day}|${vc.category.id}`] ?? [])
          if (it.depth === 0)
            weekEntries.push({
              id: it.id,
              date: it.date,
              text: it.text.split("\n")[0]!,
              categoryId: vc.category.id,
            });
    useCabinet.setState({ weekId: view.weekId, weekEntries });
  };
  update();
  useBoard.subscribe((st, prev) => {
    if (st.view === prev.view) return;
    update();
    // 업무 추가·종료·항목 삭제 등을 Cabinet 목록에도(묶어서 한 번)
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void loadCabinet().catch(() => undefined), 800);
  });
}

/** 업무에 연결된 폴더·링크(업무 연결 + 그 업무 항목 연결) — 보드 업무 이름 옆 🗄(improve-1102-spec C7) */
export function categoryItems(
  categoryId: string,
  s: Pick<CabinetState, "items" | "links"> = useCabinet.getState(),
) {
  return [...s.items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((it) => itemCategories(it.id, s.links).includes(categoryId))
    .map((it) => it.id);
}
