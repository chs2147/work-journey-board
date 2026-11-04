// 검색 상태(features-1102-spec F1): 검색어·결과·거르기·지금 결과. 결과가 있는 동안 "검색 결과 기준 보기"(띠)는
// [검색 초기화] 전까지 유지 — 패널을 닫아도 남는다. 앱을 다시 켜면 처음부터.
import { create } from "zustand";
import type { CabinetHit, CardHit } from "../../data/repository";
import type { SearchHit } from "../../domain/search";
import { searchTerms } from "../../domain/search";
import { addDays, type DateStr } from "../../domain/week";
import { goToWeek, reportError, revealItem, setTagFilter, useBoard } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import { onDetach, setSettingsOpen } from "../common/appController";
import { closeInsights, useInsights } from "../insights/insightsStore";
import { revealBox, useNote } from "../note/noteStore";
import { setSummaryOpen, useSummary } from "../summary/summaryStore";

export type SearchFilter = "all" | "item" | "memo";
export type SearchRange = "all" | "year" | "12w";

interface SearchState {
  query: string;
  /** 마지막으로 찾은 검색어(띠·패널 제목) */
  ran: string;
  hits: SearchHit[];
  truncated: boolean;
  /** Cabinet 제목·주소에서 찾은 것(features-1102-spec F5 #7) — 목록 맨 위 따로, F3 이동 대상 아님 */
  cabinet: CabinetHit[];
  /** 지식 카드(UV3) */
  cards: CardHit[];
  filter: SearchFilter;
  range: SearchRange;
  /** 지금 결과(보이는 목록 기준 위치) */
  index: number;
  panelOpen: boolean;
  /** 결과 기준 보기 중(띠) — [검색 초기화]로만 끝난다 */
  active: boolean;
  busy: boolean;
  /** 검색 칸 포커스 요청 */
  focusSeq: number;
}

export const useSearch = create<SearchState>(() => ({
  query: "",
  ran: "",
  hits: [],
  truncated: false,
  cabinet: [],
  cards: [],
  filter: "all",
  range: "all",
  index: -1,
  panelOpen: false,
  active: false,
  busy: false,
  focusSeq: 0,
}));
const set = useSearch.setState;
const get = useSearch.getState;

/** 거르기를 적용한 목록(이동·번호는 이 목록 기준) */
export const visibleHits = (s: Pick<SearchState, "hits" | "filter">) =>
  s.filter === "all" ? s.hits : s.hits.filter((h) => h.area === s.filter);

function rangeFrom(range: SearchRange, today: DateStr): DateStr | undefined {
  if (range === "year") return `${today.slice(0, 4)}-01-01` as DateStr;
  if (range === "12w") return addDays(today, -7 * 12);
  return undefined;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

/** 검색 칸 열기(Ctrl+Shift+F) — 패널을 열고 칸에 포커스 */
export function openSearch() {
  if (useSummary.getState().open) setSummaryOpen(false);
  set((s) => ({ panelOpen: true, focusSeq: s.focusSeq + 1 }));
}

export function closePanel() {
  set({ panelOpen: false });
}

/** 글자를 칠 때 — 0.25초 쉬면 찾는다 */
export function setQuery(query: string) {
  set({ query });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void runSearch(), 250);
}

export async function runSearch(query = get().query) {
  if (timer) clearTimeout(timer);
  const j = useAppStore.getState().journal;
  if (j.state !== "ready") return;
  if (!searchTerms(query).length) {
    set({ hits: [], cabinet: [], cards: [], truncated: false, index: -1, ran: query.trim() });
    return;
  }
  const my = ++seq;
  set({ busy: true });
  try {
    const today = useBoard.getState().today;
    const { hits, truncated } = await j.repo.search(query, rangeFrom(get().range, today));
    const cabinet = await j.repo.searchCabinet(query);
    const cards = await j.repo.searchCards(query);
    // 그사이 다시 찾았거나 다른 일지로 바뀌었으면 버린다(CLAUDE.md 4-7)
    if (my !== seq || useAppStore.getState().journal !== j) return;
    if (useSummary.getState().open) setSummaryOpen(false);
    set({
      hits,
      cabinet,
      cards,
      truncated,
      ran: query.trim(),
      index: -1,
      active: true,
      panelOpen: true,
      busy: false,
    });
  } catch (e) {
    set({ busy: false });
    reportError(e);
  }
}

export function setFilter(filter: SearchFilter) {
  set({ filter, index: -1 });
}

export function setRange(range: SearchRange) {
  set({ range });
  void runSearch();
}

/** [검색 초기화] — 결과·띠·강조를 모두 지운다 */
export function resetSearch() {
  if (timer) clearTimeout(timer);
  seq++;
  set({
    query: "",
    ran: "",
    hits: [],
    cabinet: [],
    cards: [],
    truncated: false,
    index: -1,
    active: false,
    busy: false,
    filter: "all",
  });
}

// 일지를 바꾸면 이전 일지의 결과·강조를 비운다(CLAUDE.md 4-7)
onDetach(resetSearch);

/** 결과로 이동(features-1102-spec F1 바로가기) */
export async function goToHit(i: number) {
  const list = visibleHits(get());
  const hit = list[i];
  if (!hit) return;
  set({ index: i });
  if (useAppStore.getState().settingsOpen) setSettingsOpen(false);
  if (useInsights.getState().open) closeInsights();
  try {
    if (hit.area === "item" && hit.itemId && hit.date && hit.categoryId) {
      const target = { id: hit.itemId, date: hit.date, categoryId: hit.categoryId };
      await revealItem(target);
      // 태그 필터로 숨은 업무면 필터를 풀고 다시
      const shown = useBoard.getState().view?.categories.some((c) => c.category.id === hit.categoryId);
      if (!shown && useBoard.getState().tagFilter.length) {
        setTagFilter([]);
        await new Promise((r) => setTimeout(r, 0));
        await revealItem(target);
      }
    } else if (hit.boxId) {
      if (useBoard.getState().weekId !== hit.weekId) await goToWeek(hit.weekId);
      await noteWeekReady(hit.weekId);
      revealBox(hit.boxId);
    }
  } catch (e) {
    reportError(e);
  }
}

/** 메모 상태가 그 주를 다 불러올 때까지(최대 2초) */
function noteWeekReady(weekId: string): Promise<void> {
  if (useNote.getState().weekId === weekId) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, 2000);
    const un = useNote.subscribe((s) => s.weekId === weekId && done());
    function done() {
      clearTimeout(t);
      un();
      resolve();
    }
  });
}

/** 다음/이전 결과(F3·Shift+F3·띠 ▲▼) — 끝에서 처음으로 돈다 */
export function stepHit(delta: 1 | -1) {
  const n = visibleHits(get()).length;
  if (!n) return;
  const cur = get().index;
  const next = cur < 0 ? (delta > 0 ? 0 : n - 1) : (cur + delta + n) % n;
  void goToHit(next);
}

/** 지금 보고 있는 주의 결과(보드 강조용) */
export const hitsInWeek = (hits: SearchHit[], weekId: string) => hits.filter((h) => h.weekId === weekId);

// 주간 요약을 열면 검색 패널은 닫는다(오른쪽 자리는 하나)
useSummary.subscribe((st, prev) => {
  if (st.open && !prev.open && get().panelOpen) set({ panelOpen: false });
});

/** 전역 단축키(Ctrl+Shift+F 열기 · F3/Shift+F3 이동) — Workspace에서 한 번 */
export function onSearchKey(e: KeyboardEvent) {
  if (e.isComposing) return;
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyF") {
    e.preventDefault();
    openSearch();
  } else if (e.key === "F3" && get().active) {
    e.preventDefault();
    stepHit(e.shiftKey ? -1 : 1);
  }
}
