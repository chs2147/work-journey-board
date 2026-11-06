import { create } from "zustand";
import type { CabiRepository } from "../../data/cabiRepository";
import type { JournalRepository } from "../../data/repository";
import { cloneBoardSelection, type BoardOwner, type CabiReference } from "../../domain/cabi";
import { boxText, noteAssetIds, type NoteDoc } from "../../domain/note";
import type { Category } from "../../domain/types";
import type { Settings } from "../../data/settings";
import { loadPlatform } from "../../platform";
import { resolveTheme } from "../../shared/theme";
import type { CabiBridge, CabiWindowSpec } from "../../platform/cabiBridge";
import { useAppStore } from "../common/appStore";
import { onDetach } from "../common/appController";
import { useNote } from "../note/noteStore";
import { goToWeek, useBoard, toast } from "../board/boardStore";
import { openItem, loadCabinet } from "./cabinetStore";

const METHODS = [
  "listNotes",
  "note",
  "createNote",
  "saveNote",
  "removeNote",
  "referenceCount",
  "listBoards",
  "board",
  "saveBoard",
  "weeklyMemos",
  "assets",
  "assetMeta",
  "asset",
  "assetView",
  "addAsset",
  "setThumb",
  "pruneAssets",
  "removeBoard",
] as const;
type Method = (typeof METHODS)[number];
export type CabiClient = Pick<CabiRepository, Method>;
export interface CabiContext {
  epoch: string;
  theme: import("../../shared/theme").ThemePref;
  dataDir: string;
  categories: Category[];
  settings: Settings;
  weekId: string;
  view: ReturnType<typeof useBoard.getState>["view"];
  cells: ReturnType<typeof useBoard.getState>["cells"];
  today: string;
}
export const useCabiChange = create<{
  version: number;
  disconnected: boolean;
  locked: boolean;
  dragPreview: { count: number; resource: boolean } | null;
}>(() => ({
  version: 0,
  disconnected: false,
  locked: false,
  dragPreview: null,
}));
let context: CabiContext | null = null,
  hostRepo: JournalRepository | null = null,
  epoch = "",
  bridge: CabiBridge | null = null,
  hostStarted = false;
let childFlush: (() => Promise<void>) | null = null;
const flushWaiters = new Map<
  string,
  {
    pending: Set<string>;
    resolve: () => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const drags = new Map<
  string,
  {
    epoch: string;
    sender: string;
    owner: BoardOwner | null;
    doc: NoteDoc;
    expires: number;
    source: BoardOwner | null;
  }
>();
const endedDrags = new Set<string>();
let clipboard: (typeof drags extends Map<string, infer V> ? V : never) | null = null;
function local() {
  const j = useAppStore.getState().journal;
  if (j.state !== "ready") throw new Error("일지를 먼저 열어 주세요.");
  return j;
}
const isMain = () =>
  new URLSearchParams(location.search).get("win") !== "cabi" &&
  new URLSearchParams(location.search).get("win") !== "cabinet";
function bump() {
  useCabiChange.setState((s) => ({ version: s.version + 1 }));
}
function detachCabi() {
  hostRepo = null;
  epoch = "";
  drags.clear();
  endedDrags.clear();
  clipboard = null;
  context = null;
  for (const w of flushWaiters.values()) {
    clearTimeout(w.timer);
    w.reject(new Error("워크스페이스가 변경되었습니다."));
  }
  flushWaiters.clear();
  void bridge?.publish({ type: "detach" });
  useCabiChange.setState({ dragPreview: null });
  bump();
}
onDetach(detachCabi);
async function getBridge() {
  if (!bridge) bridge = (await loadPlatform()).cabi;
  return bridge;
}
export async function startCabiHost() {
  const b = await getBridge();
  if (!isMain()) return;
  const j = local();
  if (hostRepo !== j.repo) {
    hostRepo = j.repo;
    epoch = crypto.randomUUID();
    drags.clear();
  }
  if (hostStarted) return;
  hostStarted = true;
  await b.serve(async (name, args, sender) => handle(name, args, sender));
  useBoard.subscribe((s, prev) => {
    if (s.saving === 0 && prev.saving > 0) {
      void b.publish({ type: "changed" }).catch(() => undefined);
      bump();
    }
  });
}
export async function cabiContext(): Promise<CabiContext> {
  if (!isMain() && useCabiChange.getState().disconnected)
    throw new Error("이 창은 이전 워크스페이스에 연결되어 있습니다. 다시 열어 주세요.");
  if (!isMain() && context) return context;
  if (isMain()) {
    await startCabiHost();
    const j = local(),
      s = useBoard.getState();
    return {
      epoch,
      theme: useAppStore.getState().theme,
      dataDir: j.dataDir,
      categories: (await j.repo.listCategories()).categories,
      settings: await j.repo.getSettings(),
      weekId: s.weekId,
      view: s.view,
      cells: s.cells,
      today: s.today,
    };
  }
  context = (await (await getBridge()).call("hello", [])) as CabiContext;
  useCabiChange.setState({ disconnected: false });
  return context;
}
export async function cabiCall<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
  if (isMain()) {
    await startCabiHost();
    return (await handle(name, [epoch, ...args], "main")) as T;
  }
  if (useCabiChange.getState().disconnected)
    throw new Error("워크스페이스가 변경되었습니다. 이 창을 다시 열어 주세요.");
  if (!context) await cabiContext();
  return (await (await getBridge()).call(name, [context!.epoch, ...args])) as T;
}
export const cabiClient = (): CabiClient =>
  Object.fromEntries(
    METHODS.map((method) => [method, (...args: unknown[]) => cabiCall("repo", method, ...args)]),
  ) as unknown as CabiClient;
export async function listenCabi() {
  return (await getBridge()).listen((m) => {
    if (m.type === "changed") bump();
    if (m.type === "dragPreview")
      useCabiChange.setState({ dragPreview: m.preview as { count: number; resource: boolean } | null });
    if (m.type === "unlock") useCabiChange.setState({ locked: false });
    if (m.type === "detach") {
      useCabiChange.setState({ disconnected: true });
    }
    if (m.type === "flush" && typeof m.id === "string")
      void (async () => {
        if (m.lock) useCabiChange.setState({ locked: true });
        let error: string | null = null;
        try {
          await childFlush?.();
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        await cabiCall("flushAck", m.id, error);
      })();
  });
}
export async function flushCabiDocument() {
  await childFlush?.();
}
export function registerCabiFlush(fn: () => Promise<void>) {
  childFlush = fn;
  return () => {
    if (childFlush === fn) childFlush = null;
  };
}
export async function flushCabiWindows(lock = false) {
  if (!isMain() || !bridge) return;
  const targets = await bridge.opened();
  if (!targets.length) return;
  const id = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      flushWaiters.delete(id);
      reject(
        new Error("Cabi.NET 창의 저장을 확인하지 못했습니다. 열린 노트와 보드의 저장 상태를 확인해 주세요."),
      );
    }, 20_000);
    flushWaiters.set(id, { pending: new Set(targets), resolve, reject, timer });
    for (const target of targets) void bridge!.publish({ type: "flush", id, lock }, target).catch(reject);
  });
}
export async function closeCabiWindows() {
  try {
    await flushCabiWindows(true);
    await bridge?.closeAll();
  } catch (e) {
    await bridge?.publish({ type: "unlock" });
    throw e;
  }
}
export async function openCabi(kind: CabiWindowSpec["kind"], id: string) {
  await cabiCall("open", kind, id);
}
export async function createCabiNote(categoryId: string) {
  const note = await cabiClient().createNote(categoryId);
  await openCabi("note", note.id);
  return note;
}
export async function registerCabiDrag(token: string, owner: BoardOwner, doc: NoteDoc, ids: string[]) {
  const selected = {
    ...doc,
    boxes: doc.boxes.filter((b) => ids.includes(b.id)),
    edges: (doc.edges ?? []).filter((e) => ids.includes(e.from) && ids.includes(e.to)),
  };
  await cabiCall("dragStart", token, owner, selected);
}
export async function receiveCabiDrag(
  token: string,
  owner: BoardOwner,
  at: { x: number; y: number },
): Promise<NoteDoc> {
  return cabiCall("dragReceive", token, owner, at);
}
export async function resolveCabiReference(
  reference: CabiReference,
): Promise<{ title: string; text: string; missing: boolean }> {
  return cabiCall("reference", reference);
}
export async function openCabiReference(reference: CabiReference) {
  await cabiCall("openReference", reference);
}

async function handle(name: string, args: unknown[], sender: string): Promise<unknown> {
  const j = local();
  if (hostRepo !== j.repo) {
    hostRepo = j.repo;
    epoch = crypto.randomUUID();
    drags.clear();
  }
  if (name === "hello") {
    const s = useBoard.getState();
    return {
      epoch,
      theme: useAppStore.getState().theme,
      dataDir: j.dataDir,
      categories: (await j.repo.listCategories()).categories,
      settings: await j.repo.getSettings(),
      weekId: s.weekId,
      view: s.view,
      cells: s.cells,
      today: s.today,
    };
  }
  if (args[0] !== epoch)
    throw new Error("워크스페이스가 변경되었습니다. 이 창의 내용을 내보낸 뒤 다시 열어 주세요.");
  const a = args.slice(1),
    r = j.repo.cabi;
  const requestEpoch = epoch;
  const assertCurrent = () => {
    if (epoch !== requestEpoch || hostRepo !== j.repo)
      throw new Error("워크스페이스가 변경되었습니다. 다시 시도해 주세요.");
  };
  if (name === "repo") {
    const method = a[0] as Method;
    if (!(METHODS as readonly unknown[]).includes(method)) throw new Error("허용되지 않은 문서 요청입니다.");
    const fn = r[method] as (...v: unknown[]) => Promise<unknown>;
    if (method === "removeNote" || method === "removeBoard") await flushCabiWindows();
    const out = await fn.apply(r, a.slice(1));
    assertCurrent();
    if (method === "saveBoard" || method === "removeBoard") {
      const { refreshLinkedObjects } = await import("../board/boardStore");
      await refreshLinkedObjects();
    }
    if (["createNote", "removeNote", "removeBoard"].includes(method) || (method === "board" && a[2] === true))
      await loadCabinet();
    if (
      ![
        "listNotes",
        "note",
        "referenceCount",
        "listBoards",
        "weeklyMemos",
        "assets",
        "assetMeta",
        "asset",
        "assetView",
        "board",
      ].includes(method) ||
      (method === "board" && a[2] === true)
    ) {
      await (await getBridge()).publish({ type: "changed", epoch, method });
      bump();
    }
    return out;
  }
  if (name === "flushAck") {
    const id = String(a[0]),
      wait = flushWaiters.get(id);
    if (!wait || !wait.pending.has(sender)) return null;
    if (a[1]) {
      clearTimeout(wait.timer);
      flushWaiters.delete(id);
      wait.reject(new Error(String(a[1])));
      return null;
    }
    wait.pending.delete(sender);
    if (!wait.pending.size) {
      clearTimeout(wait.timer);
      flushWaiters.delete(id);
      wait.resolve();
    }
    return null;
  }
  if (name === "openEntry") {
    const { revealItem } = await import("../board/boardStore");
    await revealItem(a[0] as Parameters<typeof revealItem>[0]);
    return null;
  }
  if (name === "settings")
    return a.length
      ? j.repo.updateSettings(a[0] as Parameters<JournalRepository["updateSettings"]>[0])
      : j.repo.getSettings();
  if (name === "items") return j.repo.getItemsByIds(a[0] as string[]);
  if (name === "snapshot") {
    await loadCabinet();
    const { snapshot } = await import("./cabinetStore");
    return snapshot();
  }
  if (name === "open") {
    const kind = a[0] as "note" | "board",
      id = String(a[1]);
    let title: string;
    if (kind === "note") title = (await r.note(id)).title;
    else if (kind === "board") {
      await r.board(id, true);
      title = (await j.repo.listCategories()).categories.find((c) => c.id === id)?.name ?? "업무 보드";
    } else throw new Error("창 종류가 올바르지 않습니다.");
    assertCurrent();
    await (await getBridge()).open({ kind, id, title, theme: resolveTheme(useAppStore.getState().theme) });
    return null;
  }
  if (name === "reference" || name === "openReference") {
    const ref = a[0] as CabiReference;
    if (ref.kind === "note") {
      try {
        const n = await r.note(ref.id);
        if (name === "openReference") return handle("open", [epoch, "note", n.id], sender);
        const { cabiText } = await import("../../domain/cabi");
        return { title: n.title, text: cabiText(n.content).slice(0, 300), missing: false };
      } catch {
        return { title: "삭제된 노트", text: "원본을 찾을 수 없습니다.", missing: true };
      }
    }
    if (ref.kind === "memo") {
      const doc =
          ref.weekId === useNote.getState().weekId && !useNote.getState().task
            ? useNote.getState().doc
            : (await j.repo.getWeekNote(ref.weekId)).doc,
        box = doc.boxes.find((b) => b.id === ref.boxId);
      if (name === "openReference") {
        await goToWeek(ref.weekId);
        const { revealMemo } = await import("../note/noteStore");
        await revealMemo(ref.weekId, ref.boxId);
        return null;
      }
      return {
        title: box ? boxText(box).slice(0, 100) || "이미지 메모" : "원본 메모 없음",
        text: box ? boxText(box).slice(0, 300) : "원본 메모가 삭제되었습니다.",
        missing: !box,
        ...(box && (box.kind === "image" || (box.kind === "link" && box.asset))
          ? { image: await j.repo.getNoteAssetView(box.asset!) }
          : {}),
      };
    }
    const items = (await j.repo.listCabinet()).items;
    const item = items.find((it) => it.id === ref.id);
    if (name === "openReference" && item) {
      await openItem(item.id);
      return null;
    }
    return {
      title: item?.title ?? "원본 자료 없음",
      text: item?.target ?? "등록 자료가 삭제되었습니다.",
      missing: !item,
    };
  }
  if (name === "source") return r.source(a[0] as BoardOwner);
  if (name === "dragEnd") {
    if (a[0]) endedDrags.add(String(a[0]));
    if (endedDrags.size > 1024) endedDrags.clear();
    useCabiChange.setState({ dragPreview: null });
    await (await getBridge()).publish({ type: "dragPreview", preview: null });
    return null;
  }
  if (name === "dragResource") {
    const [token, ref] = a as [string, CabiReference];
    if (!/^[\w-]{20,80}$/.test(token)) throw new Error("끌기 식별자가 올바르지 않습니다.");
    const value = (await handle("reference", [epoch, ref], sender)) as { title: string; missing: boolean };
    assertCurrent();
    if (value.missing) throw new Error("원본 자료가 없습니다.");
    const { referenceBox } = await import("../../domain/cabi");
    assertCurrent();
    drags.set(token, {
      epoch: requestEpoch,
      sender,
      owner: null,
      doc: { v: 1, boxes: [referenceBox(crypto.randomUUID(), ref, value.title, 0, 0, 1)] },
      source: null,
      expires: Date.now() + 90_000,
    });
    const preview = { count: 1, resource: true };
    if (!endedDrags.has(token)) {
      useCabiChange.setState({ dragPreview: preview });
      await (await getBridge()).publish({ type: "dragPreview", preview });
    }
    return null;
  }
  if (name === "dragStart") {
    const [token, owner, doc] = a as [string, BoardOwner, NoteDoc];
    if (!/^[\w-]{20,80}$/.test(token) || !doc?.boxes?.length || doc.boxes.length > 500)
      throw new Error("복제할 객체를 다시 선택해 주세요.");
    if (owner.kind === "task") await r.board(owner.categoryId);
    else if (owner.kind !== "week" || !/^\d{4}-W\d{2}$/.test(owner.weekId))
      throw new Error("보드 출처가 올바르지 않습니다.");
    if (JSON.stringify(doc).length > 4_000_000) throw new Error("한 번에 복제할 내용이 너무 큽니다.");
    const allowed = await r.source(owner),
      liveIds = new Set(noteAssetIds(allowed));
    if (noteAssetIds(doc).some((id) => !liveIds.has(id)))
      throw new Error("원본 이미지 저장을 마친 후 다시 끌어 주세요.");
    for (const [key, value] of drags) if (value.expires < Date.now()) drags.delete(key);
    assertCurrent();
    drags.set(token, {
      epoch: requestEpoch,
      sender,
      owner,
      doc,
      source: owner,
      expires: Date.now() + 90_000,
    });
    const preview = { count: doc.boxes.length, resource: false };
    if (!endedDrags.has(token)) {
      useCabiChange.setState({ dragPreview: preview });
      await (await getBridge()).publish({ type: "dragPreview", preview });
    }
    return null;
  }
  if (name === "clipboardSet") {
    const data = drags.get(String(a[0]));
    if (!data || data.epoch !== epoch) throw new Error("복사할 객체를 다시 선택하세요.");
    clipboard = { ...data, expires: Date.now() + 600_000 };
    await handle("dragEnd", [epoch, String(a[0])], sender);
    return null;
  }
  if (name === "clipboardGet") {
    if (!clipboard || clipboard.epoch !== epoch || clipboard.expires < Date.now())
      throw new Error("이 워크스페이스에서 복사한 객체가 없습니다.");
    const token = crypto.randomUUID();
    drags.set(token, { ...clipboard, owner: null });
    return token;
  }
  if (name === "dragReceive") {
    const [token, owner, at] = a as [string, BoardOwner, { x: number; y: number }];
    let drag = drags.get(token);
    for (let tries = 0; !drag && tries < 20; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      drag = drags.get(token);
    }
    if (!drag || drag.epoch !== epoch || drag.expires < Date.now())
      throw new Error("다른 워크스페이스의 객체이거나 끌기 시간이 만료되었습니다. 다시 끌어 주세요.");
    if (JSON.stringify(owner) === JSON.stringify(drag.owner))
      throw new Error("같은 보드에서는 기존 객체를 이동해 주세요.");
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) throw new Error("놓을 위치가 올바르지 않습니다.");
    const board = owner.kind === "task" ? await r.board(owner.categoryId, true) : null;
    if (owner.kind !== "week" && owner.kind !== "task") throw new Error("받을 보드가 올바르지 않습니다.");
    void board;
    drags.delete(token); // Claim before awaiting: duplicate native drops cannot create duplicate assets.
    if (drag.owner) {
      const latest = await r.source(drag.owner);
      if (drag.doc.boxes.some((b) => !latest.boxes.some((c) => c.id === b.id)))
        throw new Error("원본 객체가 삭제되었습니다. 다시 선택해 주세요.");
    }
    assertCurrent();
    const map = drag.source ? await r.copyOwnedAssets(drag.source, owner, noteAssetIds(drag.doc)) : {};
    assertCurrent();
    const result = cloneBoardSelection(
      drag.doc,
      drag.doc.boxes.map((b) => b.id),
      () => crypto.randomUUID(),
      at,
      map,
    );
    drags.delete(token);
    await handle("dragEnd", [epoch, token], sender);
    return result;
  }
  if (name === "notice") {
    toast(String(a[0]));
    return null;
  }
  throw new Error("허용되지 않은 Cabi.NET 요청입니다.");
}
