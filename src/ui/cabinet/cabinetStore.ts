// Cabinet 화면 상태(features-1102-spec F5). 등록·연결은 일지(JournalRepository), 열린 창·하위 위치는 이 PC 설정(config.json `cabinet`).
// 폴더 창: 실앱 = 별도 OS 창(Platform.folderWindows), 브라우저 모드 = 앱 안 떠 있는 창(같은 FolderView).
import { create } from "zustand";
import {
  folderTitle,
  groupCabinet,
  isFolderPathLike,
  itemCategories,
  parseLinkTransfer,
  UNLINKED,
  type CabinetFilter,
  type CabinetItem,
  type CabinetLink,
  type CabinetLinkDraft,
  type LinkTransfer,
} from "../../domain/cabinet";
import { shortDateLabel } from "../../domain/week";
import type { Category } from "../../domain/types";
import type { CabinetConfig, FolderWindowSpec } from "../../platform";
import { resolveTheme } from "../../shared/theme";
import { STR } from "../../shared/strings";
import { reportError, toast } from "../board/boardStore";
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
  /** 왼쪽에서 고른 묶음(업무 id 또는 UNLINKED) */
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
}

export const useCabinet = create<CabinetState>(() => ({
  open: false,
  items: [],
  links: [],
  categories: [],
  group: null,
  filter: "all",
  renaming: null,
  linkDialog: null,
  linksFor: null,
  folders: [],
  flash: null,
}));

const app = () => useAppStore.getState();
const repo = () => {
  const j = app().journal;
  return j.state === "ready" ? j.repo : null;
};

/** 설정 저장(열린 창 상태) — 잦은 이동은 묶어서 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let exiting = false;
let listening = false;
function persist() {
  if (exiting) return;
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

export async function loadCabinet() {
  const r = repo();
  if (!r) return;
  const [{ items, links }, { categories }] = await Promise.all([r.listCabinet(), r.listCategories()]);
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
  useCabinet.setState({ items, links, categories: sorted });
  await app()
    .platform?.cabinetSetRoots(items.filter((i) => i.kind === "folder").map((i) => i.target))
    .catch(() => undefined);
  // 지워진 항목의 폴더 창은 닫는다
  const ids = new Set(items.map((i) => i.id));
  const gone = useCabinet.getState().folders.filter((f) => !ids.has(f.id));
  if (gone.length) useCabinet.setState((s) => ({ folders: s.folders.filter((f) => ids.has(f.id)) }));
}

export function groupsOf(s: Pick<CabinetState, "items" | "links" | "categories">) {
  return groupCabinet(
    s.items,
    s.links,
    s.categories.map((c) => c.id),
  );
}

/** 지금 보일 묶음 — 고른 게 없거나 사라졌으면 첫 묶음 */
export function currentGroup(s: CabinetState): string | null {
  const gs = groupsOf(s);
  if (s.group && (gs.some((g) => g.key === s.group) || s.group === UNLINKED)) return s.group;
  return gs[0]?.key ?? null;
}

export async function openCabinet(opts: { categoryId?: string; itemId?: string } = {}) {
  useCabinet.setState({ open: true });
  await loadCabinet();
  const s = useCabinet.getState();
  if (opts.itemId) {
    const cats = itemCategories(opts.itemId, s.links);
    useCabinet.setState({ group: cats[0] ?? UNLINKED, filter: "all", flash: opts.itemId });
    setTimeout(() => {
      if (useCabinet.getState().flash === opts.itemId) useCabinet.setState({ flash: null });
    }, 1600);
  } else if (opts.categoryId) useCabinet.setState({ group: opts.categoryId });
  persist();
}

export function closeCabinet() {
  useCabinet.setState({ open: false, renaming: null, linkDialog: null, linksFor: null });
  persist();
}

export function toggleCabinet() {
  if (useCabinet.getState().open) closeCabinet();
  else void openCabinet();
}

/** 묶음에 맞는 기본 연결(업무 묶음이면 그 업무) */
function defaultLinks(): CabinetLinkDraft[] {
  const g = currentGroup(useCabinet.getState());
  return g && g !== UNLINKED ? [{ categoryId: g }] : [];
}

async function addFolderPaths(paths: string[], links = defaultLinks()) {
  const r = repo();
  if (!r) return;
  const ok = paths.filter(isFolderPathLike);
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

/** 놓기: 탐색기 폴더(A안 — 경로) 또는 브라우저 링크 */
export async function handleDrop(dt: DataTransfer) {
  const files = [...dt.files];
  if (files.length) {
    const p = app().platform;
    const got = (await p?.droppedPaths(files).catch(() => null)) ?? null;
    if (!got) return toast(STR.cabinet.noPath);
    const dirs = got.filter((g) => g.isDir).map((g) => g.path);
    if (!dirs.length) return toast(STR.cabinet.onlyFolders);
    await addFolderPaths(dirs);
    if (dirs.length < got.length) toast(STR.cabinet.onlyFolders);
    return;
  }
  const link = parseLinkTransfer(transferOf(dt));
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

export async function revealItem(id: string) {
  const it = useCabinet.getState().items.find((i) => i.id === id);
  if (it?.kind === "folder") await app().platform?.cabinetReveal(it.target).catch(reportError);
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

/** 항목 열기: 폴더 = 폴더 창, 링크 = 기본 브라우저 */
export async function openItem(id: string) {
  const it = useCabinet.getState().items.find((i) => i.id === id);
  if (!it) return;
  if (it.kind === "link") return openLink(it.target);
  return openFolder(id);
}

export async function openFolder(id: string, sub?: string) {
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
  useCabinet.setState((s) => ({ folders: s.folders.filter((f) => f.id !== id) }));
  persist();
}

/** 앱을 켤 때: 이 PC 설정에 적힌 Cabinet 창·폴더 창을 다시 연다 + OS 창 알림 받기 */
export async function restoreCabinet() {
  const p = app().platform;
  if (!p) return;
  await loadCabinet();
  if (!listening && p.folderWindows) {
    listening = true;
    await p.folderWindows.onEvent((e) => {
      if (e.type === "nav") setFolderSub(e.id, e.sub);
      else if (!exiting) void closeFolder(e.id);
    });
  }
  const cfg = (await p.loadConfig().catch(() => null))?.cabinet;
  if (!cfg) return;
  if (cfg.open) useCabinet.setState({ open: true });
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

/** 업무 → 연결된 Cabinet 항목 수(보드 업무 머리 메뉴), 항목 → 연결된 폴더·링크(보드 🗂 표시) */
export function entryLinks(
  entryId: string,
  s: Pick<CabinetState, "links" | "items"> = useCabinet.getState(),
) {
  return s.links.filter((l) => l.entryId === entryId).map((l) => l.itemId);
}
