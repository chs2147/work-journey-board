// 주간 요약 패널 상태(overview 10-7, output-spec 2-3, i-m2-plan M2-S1).
// - 자동 집계본은 저장하지 않고 보드 화면 상태에서 바로 계산한다(입력 중인 글까지 즉시 반영).
// - 수정본만 저장한다. 근거 해시는 만들 때·다시 만들 때·[확인함]을 누를 때 정해지고, 글을 고쳐도 그대로다
//   → 기록이 바뀌었다는 안내는 사용자가 확인할 때까지 남는다.
import { create } from "zustand";
import { basisText, buildWeeklySummary, finalVersion, type SummaryInput } from "../../domain/aggregate";
import type { WeekId } from "../../domain/week";
import type { JournalRepository, WeeklySummary } from "../../data/repository";
import { sha256Hex } from "../../shared/hash";
import { STR } from "../../shared/strings";
import { reportError, splitKey, toast, track, useBoard, SAVE_DELAY_MS } from "../board/boardStore";
import { useAppStore } from "../common/appStore";

export type SummaryTab = "auto" | "edited";

export interface SummaryState {
  open: boolean;
  /** 패널 안으로 포커스를 옮겨 달라는 요청(Alt+S로 열 때) */
  focusRequest: number;
  tab: SummaryTab;
  includeMemo: boolean;
  /** 아래 saved가 어느 주의 것인가 */
  weekId: WeekId;
  saved: WeeklySummary | null;
  /** 편집 중인 수정본(저장 전 포함). null = 수정본 없음 */
  draft: string | null;
  compareOpen: boolean;
}

export const useSummary = create<SummaryState>(() => ({
  open: false,
  focusRequest: 0,
  tab: "auto",
  includeMemo: true,
  weekId: "",
  saved: null,
  draft: null,
  compareOpen: false,
}));

const set = useSummary.setState;
const get = useSummary.getState;

let repo: JournalRepository | null = null;
let draftTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

/** 보드 화면 상태 → 자동 집계 입력. 그 주에 보이는 업무(보드 순서)와 화면의 칸·메모 */
export function boardSummaryInput(): SummaryInput | null {
  const { view, cells, memos, weekId } = useBoard.getState();
  if (!view || view.weekId !== weekId) return null;
  return {
    weekId,
    categories: view.categories.map((v) => ({ id: v.category.id, name: v.category.name })),
    items: Object.entries(cells).flatMap(([key, list]) => {
      const { date, categoryId } = splitKey(key);
      return list.map((d) => ({ date, categoryId, depth: d.depth, text: d.text }));
    }),
    memos,
  };
}

export function autoText(input: SummaryInput, includeMemo: boolean): string {
  return buildWeeklySummary(input, { includeMemo });
}

/** 지금 기록의 근거 해시 */
export async function currentBasisHash(): Promise<string | null> {
  const input = boardSummaryInput();
  return input ? sha256Hex(basisText(input)) : null;
}

export async function initSummary(r: JournalRepository) {
  repo = r;
  const settings = await r.getSettings();
  set({
    open: settings.ui.summaryPanelOpen,
    includeMemo: settings.summary.includeMemo,
    tab: "auto",
    compareOpen: false,
  });
  await loadWeek(useBoard.getState().weekId);
  // 보드가 다른 주로 가면 패널도 따라간다
  unsubscribe?.();
  unsubscribe = useBoard.subscribe((s, prev) => {
    if (s.weekId !== prev.weekId) void loadWeek(s.weekId);
  });
}

async function loadWeek(weekId: WeekId) {
  if (!repo || !weekId) return;
  await flushDraft();
  try {
    const saved = await repo.getWeeklySummary(weekId);
    if (useBoard.getState().weekId !== weekId) return; // 그 사이 또 이동
    set({
      weekId,
      saved,
      draft: saved.editedText,
      compareOpen: false,
      tab: get().tab === "edited" && saved.editedText === null ? "auto" : get().tab,
    });
  } catch (e) {
    reportError(e);
  }
}

export function setSummaryOpen(open: boolean, focus = false) {
  set((s) => ({ open, focusRequest: open && focus ? s.focusRequest + 1 : s.focusRequest }));
  if (!open) void flushDraft();
  void repo?.updateSettings({ ui: { summaryPanelOpen: open } }).catch(() => undefined);
}

export function toggleSummary(focus = false) {
  setSummaryOpen(!get().open, focus);
}

export function setTab(tab: SummaryTab) {
  set({ tab, compareOpen: false });
}

export function setIncludeMemo(on: boolean) {
  set({ includeMemo: on });
  void repo?.updateSettings({ summary: { includeMemo: on } }).catch(reportError);
}

async function writeEdited(text: string, basisHash: string) {
  const r = repo;
  const weekId = get().weekId;
  if (!r || !weekId) return;
  await track(() => r.saveEdited(weekId, text, basisHash));
  set({ saved: await r.getWeeklySummary(weekId) });
}

/** 수정본 만들기 / 자동 집계로 다시 만들기: 지금 자동 집계본으로 채우고 근거를 지금 기록으로 */
export async function makeEdited() {
  const input = boardSummaryInput();
  if (!input) return;
  clearDraftTimer();
  const text = autoText(input, get().includeMemo);
  set({ draft: text, tab: "edited", compareOpen: false });
  try {
    await writeEdited(text, await sha256Hex(basisText(input)));
  } catch (e) {
    reportError(e);
  }
}

/** 수정본 편집 — 0.5초 뒤 자동 저장(보드와 같은 감각). 근거 해시는 그대로 */
export function editDraft(text: string) {
  set({ draft: text });
  clearDraftTimer();
  draftTimer = setTimeout(() => void flushDraft(), SAVE_DELAY_MS);
}

function clearDraftTimer() {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = null;
}

export async function flushDraft() {
  if (!draftTimer) return;
  clearDraftTimer();
  const { draft, saved } = get();
  if (draft === null || !saved || draft === saved.editedText) return;
  try {
    await writeEdited(draft, saved.editedBasisHash ?? (await currentBasisHash()) ?? "");
  } catch (e) {
    reportError(e);
  }
}

/** 기록 변경 안내에 [확인함] — 근거를 지금 기록으로 옮긴다(글은 그대로) */
export async function acknowledgeChange() {
  const hash = await currentBasisHash();
  const { draft } = get();
  if (hash === null || draft === null) return;
  clearDraftTimer();
  try {
    await writeEdited(draft, hash);
    set({ compareOpen: false });
  } catch (e) {
    reportError(e);
  }
}

export async function deleteEdited() {
  const r = repo;
  const weekId = get().weekId;
  if (!r || !weekId) return;
  clearDraftTimer();
  try {
    const prev = await track(() => r.deleteEdited(weekId));
    set({ saved: await r.getWeeklySummary(weekId), draft: null, tab: "auto", compareOpen: false });
    toast(STR.summary.deleted, {
      label: STR.toast.undo,
      run: () =>
        void (async () => {
          await track(() => r.restoreEdited(prev));
          if (get().weekId === weekId) {
            const saved = await r.getWeeklySummary(weekId);
            set({ saved, draft: saved.editedText, tab: "edited" });
          }
        })().catch(reportError),
    });
  } catch (e) {
    reportError(e);
  }
}

export function setCompareOpen(open: boolean) {
  set({ compareOpen: open });
}

/** [최종본 복사] — 수정본 > AI본 > 자동 집계본(output-spec 2-3). 사용자가 누를 때만 클립보드에 쓴다 */
export async function copyFinal() {
  const { saved, draft, includeMemo } = get();
  const input = boardSummaryInput();
  const version = finalVersion({ editedText: draft, aiText: saved?.aiText });
  const text =
    version === "edited"
      ? draft!
      : version === "ai"
        ? saved!.aiText!
        : input
          ? autoText(input, includeMemo)
          : "";
  const platform = useAppStore.getState().platform;
  try {
    await platform?.writeClipboard(text);
    toast(STR.summary.copied(STR.summary.versionName[version]));
  } catch (e) {
    reportError(e);
  }
}
