// 기존 일지 가져오기 마법사 상태(i-m3-plan 3-5): ① 준비 ② 파일 ③ 미리보기·주별 처리 ④ 결과.
// 쓰기는 저장소(applyImport·undoImport)만 거치고, 그 직전에 자동 백업한다(CLAUDE.md 4-3).
import { create } from "zustand";
import {
  parseRows,
  planImport,
  type ColumnMapping,
  type ImportContext,
  type ImportPlan,
  type ImportRole,
  type ParsedImport,
  type SourceKind,
  type WeekAction,
} from "../../domain/importer";
import { weekIdOf, type WeekId } from "../../domain/week";
import type { ImportResult } from "../../data/repository";
import { preImportBackup } from "../../data/session";
import { buildImportTemplate } from "../../export/importTemplate";
import { ImportReadError, readPastedText, readSourceFile, type SourceFile } from "../../import/readTable";
import { baseName, dirOf, exportPathProblem } from "../../platform";
import { STR } from "../../shared/strings";
import { flushAll, goToWeek, refreshImportant, reload, reportError, toast } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import { flushNote, reloadNote } from "../note/noteStore";
import { flushDraft } from "../summary/summaryStore";

export type ImportStep = 0 | 1 | 2 | 3;
const EMPTY_MAP: ColumnMapping = {
  weekStart: null,
  date: null,
  day: null,
  category: null,
  depth: null,
  text: null,
};

interface ImportState {
  open: boolean;
  step: ImportStep;
  busy: boolean;
  error: string | null;
  source: SourceFile | null;
  table: number;
  kind: SourceKind;
  mapping: ColumnMapping;
  headerRow: number;
  includeFuture: boolean;
  parsed: ParsedImport | null;
  ctx: ImportContext | null;
  weekActions: Record<WeekId, Exclude<WeekAction, "import">>;
  reopen: string[];
  plan: ImportPlan | null;
  result: (ImportResult & { firstWeek: WeekId | null }) | null;
}

const initial = (): Omit<ImportState, "open"> => ({
  step: 0,
  busy: false,
  error: null,
  source: null,
  table: 0,
  kind: "generic",
  mapping: EMPTY_MAP,
  headerRow: 0,
  includeFuture: false,
  parsed: null,
  ctx: null,
  weekActions: {},
  reopen: [],
  plan: null,
  result: null,
});

export const useImport = create<ImportState>(() => ({ open: false, ...initial() }));
const set = useImport.setState;
const get = useImport.getState;

function ready() {
  const j = useAppStore.getState().journal;
  const platform = useAppStore.getState().platform;
  if (j.state !== "ready" || !platform) throw new Error("일지가 열려 있지 않습니다");
  return { repo: j.repo, driver: j.driver, dataDir: j.dataDir, platform };
}

export function openImport() {
  set({ open: true, ...initial() });
}

export function closeImport() {
  if (get().busy) return;
  set({ open: false, ...initial() });
}

export function setStep(step: ImportStep) {
  set({ step, error: null });
}

// ── ① 준비 ───────────────────────────────────────────
/** [양식 엑셀 받기]: 이번 주 진행 중 업무를 채운 양식 → 저장 대화상자(엑셀 내보내기와 같은 규칙) */
export async function saveTemplate() {
  if (get().busy) return;
  set({ busy: true });
  try {
    const { repo, dataDir, platform } = ready();
    const settings = await repo.getSettings();
    let dir = settings.ui.lastExportDir;
    if (!dir || !(await platform.stat(dir)).isDir) {
      dir = platform.join(dataDir, "exports");
      await platform.ensureDir(dir);
    }
    const path = await platform.pickSaveFile(
      STR.importer.templateTitle,
      platform.join(dir, STR.importer.templateFileName(repo.today())),
    );
    if (!path) return;
    const problem = exportPathProblem(path, dataDir);
    if (problem) return toast(problem);
    const ExcelJS = (await import("exceljs")).default;
    const bytes = await buildImportTemplate(ExcelJS, {
      categories: await repo.importTemplateCategories(),
      createdAt: platform.now(),
      appVersion: __APP_VERSION__,
    });
    await platform.writeExport(path, bytes);
    await repo.updateSettings({ ui: { lastExportDir: dirOf(path) } });
    toast(STR.importer.templateSaved(baseName(path)));
  } catch (e) {
    reportError(e);
  } finally {
    set({ busy: false });
  }
}

/** [AI 지시문 복사] — 사용자가 누를 때만 클립보드에 쓴다(클립보드 다리, output-spec 5-2와 같은 성격) */
/** [AI 지시문 복사] — 성공하면 true(코드 블록 [복사]가 잠깐 "복사됨"으로 바뀜, improve-1027v5-spec 3-3) */
export async function copyPrompt(): Promise<boolean> {
  try {
    await ready().platform.writeClipboard(STR.importer.prompt);
    toast(STR.importer.promptCopied);
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}

// ── ② 파일 ───────────────────────────────────────────
async function loaded(source: SourceFile) {
  const t = source.tables[source.pick]!;
  set({
    source,
    table: source.pick,
    kind: t.detected?.kind ?? "generic",
    mapping: t.detected?.mapping ?? EMPTY_MAP,
    headerRow: t.detected?.headerRow ?? 0,
    weekActions: {},
    reopen: [],
  });
  // 알아본 표면 바로 미리보기로, 아니면 열 맞추기
  if (t.detected) await preview();
}

export async function loadFile(file: File) {
  set({ busy: true, error: null });
  try {
    await loaded(await readSourceFile(file));
  } catch (e) {
    set({ error: e instanceof ImportReadError ? e.message : STR.importer.readFailed });
  } finally {
    set({ busy: false });
  }
}

export async function loadPaste(text: string) {
  set({ busy: true, error: null });
  try {
    await loaded(readPastedText(text));
  } catch (e) {
    set({ error: e instanceof ImportReadError ? e.message : STR.importer.readFailed });
  } finally {
    set({ busy: false });
  }
}

/** 다른 시트 고르기(엑셀에 시트가 여럿일 때) */
export function pickTable(i: number) {
  const t = get().source?.tables[i];
  if (!t) return;
  set({
    table: i,
    kind: t.detected?.kind ?? "generic",
    mapping: t.detected?.mapping ?? EMPTY_MAP,
    headerRow: t.detected?.headerRow ?? 0,
  });
}

export function setMapping(role: ImportRole, col: number | null) {
  set({ mapping: { ...get().mapping, [role]: col } });
}

export const mappingReady = (m: ColumnMapping) =>
  m.category !== null && m.text !== null && (m.date !== null || (m.weekStart !== null && m.day !== null));

// ── ③ 미리보기 ──────────────────────────────────────
/** 행 해석 + 그 주들의 이 앱 상태 읽기 + 계획 */
export async function preview() {
  const s = get();
  const t = s.source?.tables[s.table];
  if (!t || !mappingReady(s.mapping)) return;
  set({ busy: true, error: null });
  try {
    const { repo } = ready();
    await flushPending(); // 입력 중이던 칸·메모가 계획의 "지금 기록"에 들어가게
    const parsed = parseRows(t.rows, s.headerRow, s.mapping, s.kind, {
      today: repo.today(),
      includeFuture: s.includeFuture,
    });
    const weeks = [...new Set(parsed.rows.map((r) => weekIdOf(r.date)))];
    const ctx = await repo.importContext(weeks);
    set({
      parsed,
      ctx,
      plan: planImport(parsed.rows, ctx, { weekActions: s.weekActions, reopen: s.reopen }),
      step: 2,
    });
  } catch (e) {
    reportError(e);
  } finally {
    set({ busy: false });
  }
}

function replan(patch: Partial<Pick<ImportState, "weekActions" | "reopen">>) {
  const s = { ...get(), ...patch };
  if (!s.parsed || !s.ctx) return set(patch);
  set({ ...patch, plan: planImport(s.parsed.rows, s.ctx, { weekActions: s.weekActions, reopen: s.reopen }) });
}

export function setWeekAction(weekId: WeekId, action: Exclude<WeekAction, "import">) {
  replan({ weekActions: { ...get().weekActions, [weekId]: action } });
}

/** 기록이 있는 주 모두 같은 처리로 */
export function setAllExisting(action: Exclude<WeekAction, "import">) {
  const weeks = (get().plan?.weeks ?? []).filter((w) => w.action !== "import").map((w) => w.weekId);
  replan({ weekActions: Object.fromEntries(weeks.map((w) => [w, action])) });
}

export function toggleReopen(id: string) {
  const r = get().reopen;
  replan({ reopen: r.includes(id) ? r.filter((x) => x !== id) : [...r, id] });
}

export async function setIncludeFuture(on: boolean) {
  set({ includeFuture: on });
  await preview();
}

async function flushPending() {
  await flushAll();
  await flushDraft();
  await flushNote();
}

/** 가져오기 뒤 화면 다시 읽기(보드·메모·중요 업무) */
async function refreshAll() {
  await reload();
  await reloadNote();
  await refreshImportant();
}

// ── ④ 가져오기 ──────────────────────────────────────
export async function runImport() {
  const s = get();
  const plan = s.plan;
  if (!plan || s.busy || (!plan.totals.items && !plan.memos.length && !plan.totals.removed)) return;
  const over = plan.weeks.filter((w) => w.action === "overwrite" && (w.remove || w.existingMemoBoxes));
  if (over.length && !window.confirm(STR.importer.confirmOverwrite(over.length, plan.totals.removed))) return;
  set({ busy: true, error: null });
  try {
    const { repo, driver, dataDir, platform } = ready();
    await flushPending();
    try {
      await preImportBackup(platform, driver, dataDir, platform.now());
    } catch (e) {
      toast(STR.importer.backupFailed(e instanceof Error ? e.message : String(e)));
      return;
    }
    const result = await repo.applyImport(plan, s.source?.fileName ?? STR.importer.pasteName);
    const firstWeek = plan.weeks.find((w) => w.action !== "skip" && (w.add || w.fileMemo))?.weekId ?? null;
    await refreshAll();
    set({ result: { ...result, firstWeek }, step: 3 });
  } catch (e) {
    reportError(e);
  } finally {
    set({ busy: false });
  }
}

export async function goFirstImportedWeek() {
  const w = get().result?.firstWeek;
  closeImport();
  if (w) await goToWeek(w);
}

/** 설정 > 가져오기 기록 [되돌리기] — 확인 두 번(되돌릴지 · 고친 항목을 남길지) */
export async function undoImportBatch(id: string, items: number): Promise<boolean> {
  try {
    const { repo } = ready();
    if (!window.confirm(STR.importer.undoConfirm(items))) return false;
    const edited = await repo.countEditedImported(id);
    const keepEdited = edited > 0 ? window.confirm(STR.importer.undoKeepEdited(edited)) : true;
    await flushPending();
    const r = await repo.undoImport(id, keepEdited);
    await refreshAll();
    toast(STR.importer.undoDone(r.removed, r.restored));
    return true;
  } catch (e) {
    reportError(e);
    return false;
  }
}
