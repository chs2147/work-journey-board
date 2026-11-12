import { CabiRepository } from "./cabiRepository";
import { KanbanRepository } from "./kanbanRepository";
import { normalizeBackupPolicy } from "./backupPolicy";
import { copyablePrevious } from "../domain/previousItems";
// 영속 데이터 접근의 유일한 경로(CLAUDE.md 4-3). UI는 이 클래스만 쓰고 SQL을 직접 실행하지 않는다.
import {
  CARD_LIMITS,
  cardProblem,
  clip,
  fingerprint,
  sourceKey,
  type CardDraft,
  type CardProblem,
  type CardSource,
  type CardSourceKind,
  type CardStatus,
  type CardType,
  type KnowledgeCard,
  type SourceNow,
} from "../domain/knowledgeCard";
import {
  relationProblem,
  type RelationProblem,
  type URelation,
  type URelationEnd,
  type URelationKind,
  type URelationType,
  type UniverseSnapshot,
} from "../domain/universe";
import {
  archiveEndDate,
  groupPeriods,
  normalizeCategoryName,
  openPeriod,
  reactivatePlan,
  visibleCategories,
  type VisibleCategory,
} from "../domain/categories";
import type { SummaryInput } from "../domain/aggregate";
import { isDayMarkKind, isLeaveWeek, isOffDay, LABEL_MAX, type DayMarkKind } from "../domain/dayMark";
import { resolveHolidays } from "../domain/holidaysKr";
import { isStartTime } from "../domain/startTime";
import { isDueDate } from "../domain/dueDate";
import { normalizeTagName, tagNameProblem, type Tag } from "../domain/tags";
import type { ExistingItem, ImportContext, ImportPlan } from "../domain/importer";
import type { ActivityRow } from "../domain/insights";
import {
  SEARCH_LIMIT,
  matchesAll,
  searchNote,
  searchTerms,
  snippet,
  sortHits,
  type SearchHit,
} from "../domain/search";
import {
  CABINET_TARGET_MAX,
  isFolderPathLike,
  normalizeCabinetTitle,
  normalizeFolderPath,
  type CabinetItem,
  type CabinetKind,
  type CabinetLink,
  type CabinetLinkDraft,
} from "../domain/cabinet";
import { isOpenableUrl } from "../domain/links";
import {
  docFromDayMemos,
  emptyDoc,
  IMAGE_MIMES,
  LINK_MAX,
  importMemoBox,
  isNoteEmpty,
  noteAssetIds,
  boxName,
  boxText,
  noteToText,
  parseNoteDoc,
  withoutRef,
  positionBelow,
  topZ,
  type ImageMime,
  type NoteDoc,
} from "../domain/note";
import type { ExportWeek } from "../export/excel";
import { normalizeCell } from "../domain/items";
import { localDate, utcTimestamp } from "../domain/localTime";
import { NUDGE_LOOKBACK_WEEKS, nudgeCandidates, snoozeUntil } from "../domain/nudge";
import {
  ruleDate,
  rulesToCreate,
  ruleTiming,
  type Recurrence,
  type RecurrenceLine,
} from "../domain/recurrence";
import type { Category, CategoryPeriod, Depth, EntryItem, ImportantItem, ItemDraft } from "../domain/types";
import {
  addDays,
  addWeeks,
  parseDate,
  weekDays,
  weekIdOf,
  weekRange,
  weekStart,
  weeksInIsoYear,
  type DateStr,
  type WeekId,
} from "../domain/week";
import { nextColorKey, type CategoryColorKey, CATEGORY_COLOR_KEYS } from "../shared/palette";
import { isCorruptError, type SqlDriver, type SqlParam, type SqlStatement } from "./driver";
import { uuidv7 } from "./ids";
import { DEFAULT_SETTINGS, mergeSettings, type Settings, type SettingsPatch } from "./settings";

export class ValidationError extends Error {}

/** 직접 연결을 저장할 수 없는 까닭(UV2) — 화면이 문구로 바꾼다 */
export class RelationError extends ValidationError {
  constructor(readonly problem: RelationProblem | "missing") {
    super(`직접 연결을 저장할 수 없습니다(${problem})`);
  }
}

/** 지식 카드를 저장할 수 없는 까닭(UV3) */
export interface CardHit {
  id: string;
  type: CardType;
  status: CardStatus;
  title: string;
  text: string;
}

export class CardError extends ValidationError {
  constructor(readonly problem: CardProblem | "missing" | "stale") {
    super(`지식 카드를 저장할 수 없습니다(${problem})`);
  }
}

type CardRow = {
  id: string;
  card_type: string;
  title: string;
  summary: string;
  conditions: string;
  body: string;
  status: string;
  revision: number;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
};
type CardSourceRow = {
  id: string;
  card_id: string;
  source_kind: string;
  source_id: string;
  source_week: string | null;
  excerpt: string;
  content_fp: string;
  location_fp: string;
  locator_json: string;
  captured_at: string;
};
const locatorOf = (json: string) => {
  try {
    const v = JSON.parse(json) as { label?: unknown };
    return typeof v.label === "string" ? v.label : "";
  } catch {
    return "";
  }
};

type RelationRow = {
  id: string;
  from_kind: string;
  from_id: string;
  from_week: string | null;
  to_kind: string;
  to_id: string;
  to_week: string | null;
  relation_type: string;
  note: string;
};
const STR_NOTE_WEEK = "메모";
const relationOf = (r: RelationRow): URelation => ({
  id: r.id,
  from: {
    kind: r.from_kind as URelationKind,
    id: r.from_id,
    ...(r.from_week ? { week: r.from_week as WeekId } : {}),
  },
  to: { kind: r.to_kind as URelationKind, id: r.to_id, ...(r.to_week ? { week: r.to_week as WeekId } : {}) },
  type: r.relation_type as URelationType,
  note: r.note,
});

export interface WeekView {
  weekId: WeekId;
  days: DateStr[];
  categories: VisibleCategory[];
  /** 키: cellKey(date, categoryId) */
  items: Record<string, EntryItem[]>;
  /** 주간 메모(weekly-note-spec) — 아직 저장한 적 없는 주는 예전 요일 메모를 상자 1개로 보여 준다 */
  note: NoteDoc;
  /** 연차·반차 표시(improve-1026-spec 1절) — 근무인 날은 없다 */
  dayMarks: Record<DateStr, DayMarkKind>;
  /** 표시의 이름·출처(공휴일 이름·휴가 사유, 직접/회사 휴일/내장 공휴일) — features-1102-spec F2·F3 */
  dayMarkInfo: Record<DateStr, DayMarkInfo>;
}

export interface DayMarkInfo {
  kind: DayMarkKind;
  label: string | null;
  /** user = 직접 고름(일지 행) · company = 회사 휴일(설정) · builtin = 내장 대한민국 공휴일 */
  source: "user" | "company" | "builtin";
}

/** 직전 기록 가져오기의 원본(improve-1026-spec 3절) */
export interface ItemRelations {
  taskNotes?: { board_id: string; box_id: string; entry_id: string }[];
  notes: { note_week_id: string; box_id: string; entry_id: string; created_at: string }[];
  cabinet: { id: string; item_id: string; entry_id: string; created_at: string }[];
}
export interface CopiedEntries {
  cells: { date: DateStr; categoryId: string; items: ItemDraft[] }[];
  relations: ItemRelations;
  placements: Record<string, string | null>;
}

export interface PreviousRecord {
  date: DateStr;
  /** 키: 업무 id, 칸 안 순서대로 */
  cells: Record<string, { id?: string; depth: Depth; text: string }[]>;
  excluded?: number;
}

/** 직전 기록을 찾는 범위(일) — 4주 */
export const PREVIOUS_LOOKBACK_DAYS = 28;
/** 종일 연차인 날은 직전 기록일로 치지 않는다 */
/** 하루 종일 쉬는 날(연차·공휴일·기타 휴가 직접 표시)은 직전 기록일 찾기에서 건너뛴다 */
const NOT_LEAVE = "date NOT IN (SELECT date FROM day_mark WHERE kind IN ('leave', 'holiday', 'other'))";

export const cellKey = (date: DateStr, categoryId: string) => `${date}|${categoryId}`;

/** 저장된 주간 요약(AI본·수정본). 자동 집계본은 저장하지 않는다(data-spec 3-3) */
export interface WeeklySummary {
  weekId: WeekId;
  aiText: string | null;
  aiBasisHash: string | null;
  aiSavedAt: string | null;
  editedText: string | null;
  editedBasisHash: string | null;
  editedAt: string | null;
}

interface WeeklySummaryRow {
  ai_text: string | null;
  ai_basis_hash: string | null;
  ai_saved_at: string | null;
  edited_text: string | null;
  edited_basis_hash: string | null;
  edited_at: string | null;
}

/** 메모 문서 최대 크기(문자) — 이미지는 문서 밖(note_asset)에 둔다 */
export const NOTE_MAX = 1_000_000;
/** 메모 이미지 1장 최대(줄인 뒤 저장 크기). 긴 변 1600px WebP는 보통 100~250KB */
export const NOTE_ASSET_MAX_BYTES = 5 * 1024 * 1024;

/** 가져오기 기록 한 줄(설정 > 가져오기 기록) */
export interface ImportBatchInfo {
  id: string;
  fileName: string;
  weeks: number;
  items: number;
  createdAt: string;
  undoneAt: string | null;
}

export interface ImportResult {
  id: string;
  items: number;
  weeks: number;
  newCategories: number;
}

interface ItemSnapshot {
  id: string;
  date: string;
  category_id: string;
  seq: number;
  depth: number;
  text: string;
  flagged: number;
  flag_done_at: string | null;
  completion_was_flagged?: number;
  recurrence_id: string | null;
  /** v10부터(그 전 되돌리기 자료에는 없음) */
  start_time?: string | null;
  /** v13부터 */
  due_date?: string | null;
  created_at: string;
  updated_at: string;
  import_id: string | null;
}

/** 되돌리기 자료(import_batch.undo_json) */
interface ImportUndo {
  relations?: ItemRelations;
  deletedItems: ItemSnapshot[];
  notes: { weekId: WeekId; doc: string | null }[];
  createdCategories: string[];
  periodStarts: { periodId: string; start: DateStr }[];
  reopened: { periodId: string; end: DateStr | null; created?: boolean }[];
}

/** 메모 이미지(weekly-note-spec 5-1). data = base64, bytes = 저장한 그림 크기 */
export interface NoteAsset {
  id: string;
  mime: ImageMime;
  data: string;
  width: number;
  height: number;
  bytes: number;
}

/** 메모 이미지의 크기·형식만(그림 데이터 없음) — 메모 판은 이것만 들고, 그림은 그릴 때 한 장씩 읽는다(optimize-1031-plan O2) */
export type NoteAssetMeta = Omit<NoteAsset, "data">;

/** 표시용 사본(메모 판에 그릴 것) — 썸네일이 있으면 썸네일, 없으면 원본 */
export interface NoteAssetView {
  mime: string;
  data: string;
  /** 썸네일이면 true */
  thumb: boolean;
}

export const NOTE_THUMB_MIMES = ["image/webp", "image/png"] as const;

/** 수정본 최대 길이(입력 실수로 거대한 글이 들어가는 것 방지) */
export const SUMMARY_MAX = 20000;

/** 주 목록 from~to(포함, 오래된 주부터). 거꾸로 주면 바로잡는다. 한 번에 최대 10년치 */
export function weekList(from: WeekId, to: WeekId): WeekId[] {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const out: WeekId[] = [];
  for (let w = a; w <= b && out.length < 530; w = addWeeks(w, 1)) out.push(w);
  return out;
}

/** 보드 한 주 → 자동 집계 입력(그 주에 보이는 업무, 보드 순서) */
export function summaryInputOf(view: WeekView): SummaryInput {
  return {
    weekId: view.weekId,
    categories: view.categories.map((v) => ({ id: v.category.id, name: v.category.name })),
    items: Object.values(view.items).flat(),
    memo: noteToText(view.note),
    dayMarks: Object.entries(view.dayMarks).map(([date, kind]) => ({
      date,
      kind,
      label: view.dayMarkInfo?.[date]?.label ?? null,
    })),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  nudge_snoozed_until: string | null;
}
interface PeriodRow {
  id: string;
  category_id: string;
  start_date: string;
  end_date: string | null;
}
interface ItemRow {
  id: string;
  date: string;
  category_id: string;
  seq: number;
  depth: number;
  text: string;
  flagged: number;
  flag_done_at: string | null;
  completion_was_flagged?: number;
  recurrence_id: string | null;
  start_time: string | null;
  due_date?: string | null;
}
interface ImportantRow extends ItemRow {
  category_name: string;
  category_color: string;
  category_order: number;
  parent_text: string | null;
}

interface RecurrenceRow {
  id: string;
  category_id: string;
  weekday: number;
  start_week: string;
  end_week: string | null;
  flag_on_create: number;
  created_at: string;
}

/** 반복 끄기의 되돌리기 정보(spec 3-1) */
export type RepeatUndo =
  | { kind: "ended"; ruleId: string; prevEnd: WeekId | null }
  | {
      kind: "deleted";
      rule: Recurrence;
      createdAt: string;
      madeWeeks: { week_id: string; created_at: string }[];
      itemIds: string[];
    };

/** 미래 주의 반복 "예정"(저장하지 않음, spec 3-2) */
export interface RepeatPreview {
  rule: Recurrence;
  date: DateStr;
}

const ITEM_COLUMNS =
  "id, date, category_id, seq, depth, text, flagged, flag_done_at, completion_was_flagged, recurrence_id, start_time, due_date";

const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  color: r.color as CategoryColorKey,
  sortOrder: Number(r.sort_order),
  nudgeSnoozedUntil: r.nudge_snoozed_until,
});
const toPeriod = (r: PeriodRow): CategoryPeriod => ({
  id: r.id,
  categoryId: r.category_id,
  startDate: r.start_date,
  endDate: r.end_date,
});
const toItem = (r: ItemRow): EntryItem => ({
  id: r.id,
  date: r.date,
  categoryId: r.category_id,
  seq: Number(r.seq),
  depth: Number(r.depth) as Depth,
  text: r.text,
  flagged: Number(r.flagged) === 1,
  flagDoneAt: r.flag_done_at,
  completionWasFlagged: r.completion_was_flagged !== 0,
  recurrenceId: r.recurrence_id,
  startTime: r.start_time ?? null,
  dueDate: r.due_date ?? null,
});

/**
 * 거의 안 바뀌는 데이터의 메모리 캐시(optimize-1031-plan O3) — 주를 넘길 때마다 다시 읽지 않는다.
 * 저장소를 거치는 쓰기 SQL에 그 표 이름이 나오면 비운다(업무를 지우면 태그 연결·반복 규칙도 함께 지워지므로 category는 셋 다).
 */
const CACHE_TABLES = {
  settings: ["app_meta"],
  categories: ["category", "category_period"],
  tags: ["tag", "category_tag", "category"],
  recurrences: ["recurrence", "recurrence_line", "category"],
} as const;
type CacheKey = keyof typeof CACHE_TABLES;
const CACHE_RES = Object.fromEntries(
  Object.entries(CACHE_TABLES).map(([k, tables]) => [k, new RegExp(`\\b(${tables.join("|")})\\b`, "i")]),
) as Record<CacheKey, RegExp>;

/** Cabinet 등록 해제 되돌리기 자료 */
export interface CabinetUndo {
  item: CabinetItem;
  links: CabinetLink[];
}

/** Cabinet 검색 결과(features-1102-spec F5 #7) */
export interface CabinetHit {
  id: string;
  kind: CabinetKind;
  title: string;
  target: string;
  text: string;
}

export class JournalRepository {
  private readonly db: SqlDriver;
  private copyQueue: Promise<void> = Promise.resolve();
  private readonly cache = new Map<CacheKey, Promise<unknown>>();
  /** 저장소를 거친 쓰기 횟수 — 마지막 백업 뒤로 바뀐 게 있는지(optimize-1031-plan B1·B3) */
  private writes = 0;
  /** 백업 중에는 쓰기를 기다리게 한다(B2 — 실앱은 연결 풀이라 백업 도중 쓰면 잠김 오류가 날 수 있음) */
  private gate: Promise<void> = Promise.resolve();
  /** 파일 파손으로 보이는 오류가 나면 부를 곳(B4) */
  private onCorrupt: ((e: unknown) => void) | null = null;

  private readonly sourceDb: SqlDriver;
  readonly cabi: CabiRepository;
  readonly kanban: KanbanRepository;
  constructor(
    db: SqlDriver,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.sourceDb = db;
    const touched = (sql: string) => {
      for (const key of Object.keys(CACHE_RES) as CacheKey[])
        if (CACHE_RES[key].test(sql)) this.cache.delete(key);
    };
    const watch = async <T>(work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } catch (e) {
        if (isCorruptError(e)) this.onCorrupt?.(e);
        throw e;
      }
    };
    this.db = {
      label: db.label,
      select: (sql, params) => watch(() => db.select(sql, params)),
      execute: async (sql, params) => {
        await this.gate;
        try {
          return await watch(() => db.execute(sql, params));
        } finally {
          this.writes++;
          touched(sql);
        }
      },
      batch: async (statements) => {
        await this.gate;
        try {
          return await watch(() => db.batch(statements));
        } finally {
          this.writes++;
          for (const st of statements) touched(st.sql);
        }
      },
      close: () => db.close(),
    };
    this.cabi = new CabiRepository(this.db, this, this.clock);
    this.kanban = new KanbanRepository(this.db, this.clock, async () => {
      const groups = groupPeriods((await this.listCategories()).periods);
      return new Set([...groups].filter(([, ps]) => !openPeriod(ps)).map(([id]) => id));
    });
  }

  /** 지금까지의 쓰기 횟수(백업 판단용) */
  get writeCount(): number {
    return this.writes;
  }

  /** 파일 파손으로 보이는 오류를 받을 곳 */
  setCorruptHandler(fn: ((e: unknown) => void) | null) {
    this.onCorrupt = fn;
  }

  /** 이 일이 끝날 때까지 저장소 쓰기를 기다리게 한다(백업 — 읽기는 그대로) */
  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const prev = this.gate;
    let open!: () => void;
    this.gate = new Promise<void>((resolve) => (open = resolve));
    await prev;
    try {
      return await work();
    } finally {
      open();
    }
  }

  /** 백업 정책 확인/저장/정리 동안 쓰기를 막는다. 콜백의 저장 함수는 같은 배타 구간에서만 사용한다. */
  async exclusiveWithSettings<T>(
    work: (save: (patch: SettingsPatch) => Promise<Settings>) => Promise<T>,
  ): Promise<T> {
    return this.exclusive(() =>
      work(async (patch) => {
        const next = mergeSettings(await this.getSettings(), patch);
        await this.sourceDb.execute(
          "INSERT INTO app_meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          [JSON.stringify(next)],
        );
        this.writes++;
        this.cache.delete("settings");
        return next;
      }),
    );
  }

  /** 캐시에서 읽기 — 부르는 쪽이 고쳐도 캐시가 바뀌지 않게 사본을 준다 */
  private async cached<T>(key: CacheKey, load: () => Promise<T>): Promise<T> {
    let hit = this.cache.get(key) as Promise<T> | undefined;
    if (!hit) {
      hit = load();
      this.cache.set(key, hit);
      hit.catch(() => {
        if (this.cache.get(key) === hit) this.cache.delete(key);
      });
    }
    return structuredClone(await hit);
  }

  private ts() {
    return utcTimestamp(this.clock());
  }

  /** 오늘(로컬 날짜) */
  today(): DateStr {
    return localDate(this.clock());
  }

  currentWeek(): WeekId {
    return weekIdOf(this.today());
  }

  // ── 설정 ─────────────────────────────────────────────
  async getSettings(): Promise<Settings> {
    return this.cached("settings", () => this.readSettings());
  }

  private async readSettings(): Promise<Settings> {
    const [row] = await this.db.select<{ value: string }>(
      "SELECT value FROM app_meta WHERE key = 'settings'",
    );
    let stored: unknown;
    try {
      stored = row ? JSON.parse(row.value) : undefined;
    } catch {
      stored = undefined; // 손상된 설정은 기본값으로
    }
    if (stored && typeof stored === "object" && "backup" in stored) {
      const old = stored as { backup: Parameters<typeof normalizeBackupPolicy>[0] };
      old.backup = normalizeBackupPolicy(old.backup, true);
    }
    if (!stored || typeof stored !== "object" || !("backup" in stored))
      stored = {
        ...(stored && typeof stored === "object" ? stored : {}),
        backup: normalizeBackupPolicy(undefined, true),
      };
    return mergeSettings(structuredClone(DEFAULT_SETTINGS), stored);
  }

  async updateSettings(patch: SettingsPatch): Promise<Settings> {
    const next = mergeSettings(await this.getSettings(), patch);
    await this.db.execute(
      "INSERT INTO app_meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [JSON.stringify(next)],
    );
    return next;
  }

  // ── 업무(카테고리) ──────────────────────────────────
  async listCategories(): Promise<{ categories: Category[]; periods: CategoryPeriod[] }> {
    return this.cached("categories", () => this.readCategories());
  }

  private async readCategories(): Promise<{ categories: Category[]; periods: CategoryPeriod[] }> {
    const cats = await this.db.select<CategoryRow>(
      "SELECT id, name, color, sort_order, nudge_snoozed_until FROM category ORDER BY sort_order",
    );
    const periods = await this.db.select<PeriodRow>(
      "SELECT id, category_id, start_date, end_date FROM category_period ORDER BY category_id, start_date",
    );
    return { categories: cats.map(toCategory), periods: periods.map(toPeriod) };
  }

  /** 새 업무. 보고 있는 주의 월요일부터 보인다(data-spec 4-3). */
  async createCategory(
    name: string,
    viewedWeek: WeekId,
    onboarding?: { tagIds: string[]; newTags: string[]; signal?: AbortSignal },
  ): Promise<Category> {
    const n = normalizeCategoryName(name);
    if (!n) throw new ValidationError("업무 이름은 1~40자여야 합니다");
    const [stat] = await this.db.select<{ n: number; maxOrder: number | null }>(
      "SELECT COUNT(*) AS n, MAX(sort_order) AS maxOrder FROM category",
    );
    const category: Category = {
      id: uuidv7(this.clock().getTime()),
      name: n,
      color: nextColorKey(Number(stat?.n ?? 0)),
      sortOrder: Number(stat?.maxOrder ?? 0) + 1,
      nudgeSnoozedUntil: null,
    };
    const ts = this.ts();
    const extra: SqlStatement[] = [];
    if (onboarding) {
      const { categories } = await this.listCategories();
      if (categories.some((c) => c.name.toLocaleLowerCase() === n.toLocaleLowerCase()))
        throw new ValidationError("이미 있는 업무 이름입니다");
      const tags = await this.listTags();
      const selected = new Set(onboarding.tagIds);
      if ([...selected].some((id) => !tags.some((t) => t.id === id)))
        throw new ValidationError("태그 목록이 바뀌었습니다. 다시 선택해 주세요");
      let order = Math.max(0, ...tags.map((t) => t.sortOrder));
      const names = [...tags];
      for (const raw of onboarding.newTags) {
        const tagName = normalizeTagName(raw);
        const existing = names.find((t) => t.name.toLowerCase() === tagName.toLowerCase());
        if (existing) {
          selected.add(existing.id);
          continue;
        }
        const problem = tagNameProblem(
          tagName,
          names.map((t) => t.name),
        );
        if (problem) throw new ValidationError(problem);
        const tag = { id: uuidv7(), name: tagName, sortOrder: ++order };
        names.push(tag);
        selected.add(tag.id);
        extra.push({
          sql: "INSERT INTO tag (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)",
          params: [tag.id, tag.name, tag.sortOrder, ts],
        });
      }
      for (const id of selected)
        extra.push({
          sql: "INSERT INTO category_tag (category_id, tag_id) VALUES (?, ?)",
          params: [category.id, id],
        });
      onboarding.signal?.throwIfAborted();
    }
    await this.db.batch([
      {
        sql: "INSERT INTO category (id, name, color, sort_order, nudge_snoozed_until, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
        params: [category.id, category.name, category.color, category.sortOrder, ts, ts],
      },
      {
        sql: "INSERT INTO category_period (id, category_id, start_date, end_date) VALUES (?, ?, ?, NULL)",
        params: [uuidv7(), category.id, weekStart(viewedWeek)],
      },
      ...extra,
    ]);
    return category;
  }

  async renameCategory(id: string, name: string): Promise<void> {
    const n = normalizeCategoryName(name);
    if (!n) throw new ValidationError("업무 이름은 1~40자여야 합니다");
    await this.db.execute("UPDATE category SET name = ?, updated_at = ? WHERE id = ?", [n, this.ts(), id]);
  }

  async setCategoryColor(id: string, color: CategoryColorKey): Promise<void> {
    if (!CATEGORY_COLOR_KEYS.includes(color)) throw new ValidationError(`알 수 없는 색: ${color}`);
    await this.db.execute("UPDATE category SET color = ?, updated_at = ? WHERE id = ?", [
      color,
      this.ts(),
      id,
    ]);
  }

  /** 보드 순서 변경: 전달한 순서대로 1, 2, 3 … */
  async reorderCategories(idsInOrder: string[]): Promise<void> {
    const ts = this.ts();
    await this.db.batch(
      idsInOrder.map((id, i) => ({
        sql: "UPDATE category SET sort_order = ?, updated_at = ? WHERE id = ?",
        params: [i + 1, ts, id],
      })),
    );
  }

  private async periodsOf(categoryId: string): Promise<CategoryPeriod[]> {
    const rows = await this.db.select<PeriodRow>(
      "SELECT id, category_id, start_date, end_date FROM category_period WHERE category_id = ? ORDER BY start_date",
      [categoryId],
    );
    return rows.map(toPeriod);
  }

  /** 종료(아카이브): 열린 구간의 끝을 오늘로. 이미 종료면 아무것도 안 함. */
  async archiveCategory(id: string): Promise<void> {
    const open = openPeriod(await this.periodsOf(id));
    if (!open) return;
    await this.db.execute("UPDATE category_period SET end_date = ? WHERE id = ?", [
      archiveEndDate(open, this.today()),
      open.id,
    ]);
  }

  /** 재활성. 이미 진행 중이면 아무것도 안 함. */
  async reactivateCategory(id: string): Promise<void> {
    const periods = await this.periodsOf(id);
    if (openPeriod(periods)) return;
    const plan = reactivatePlan(periods, weekStart(this.currentWeek()));
    const stmts: SqlStatement[] = [
      {
        sql: "UPDATE category SET nudge_snoozed_until = NULL, updated_at = ? WHERE id = ?",
        params: [this.ts(), id],
      },
    ];
    if (plan.kind === "reopen") {
      stmts.push({ sql: "UPDATE category_period SET end_date = NULL WHERE id = ?", params: [plan.periodId] });
    } else {
      stmts.push({
        sql: "INSERT INTO category_period (id, category_id, start_date, end_date) VALUES (?, ?, ?, NULL)",
        params: [uuidv7(), id, plan.startDate],
      });
    }
    await this.db.batch(stmts);
  }

  async countItems(categoryId: string): Promise<number> {
    const [r] = await this.db.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM entry_item WHERE category_id = ?",
      [categoryId],
    );
    return Number(r?.n ?? 0);
  }

  /** 기록이 한 건도 없는 업무만 실삭제(data-spec 6절). 삭제했으면 true. */
  async deleteCategoryIfEmpty(id: string): Promise<boolean> {
    if ((await this.countItems(id)) > 0) return false;
    const [owned] = await this.db.select<{ n: number }>(
      "SELECT (SELECT count(*) FROM cabi_note WHERE category_id=?) + (SELECT count(*) FROM cabi_board WHERE category_id=?) AS n",
      [id, id],
    );
    if (owned?.n) return false;
    await this.db.batch([
      { sql: "DELETE FROM category_period WHERE category_id = ?", params: [id] },
      { sql: "DELETE FROM category WHERE id = ?", params: [id] },
    ]);
    return true;
  }

  // ── 주간 보드 ───────────────────────────────────────
  /** 그 주 보기. note: false면 메모 문서를 읽지 않는다(보드 — 메모는 메모 도크가 따로 읽음, optimize-1031-plan O3) */
  async getWeek(weekId: WeekId, opts: { note?: boolean } = {}): Promise<WeekView> {
    const { start, end } = weekRange(weekId);
    const { categories, periods } = await this.listCategories();
    const rows = await this.db.select<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM entry_item WHERE date BETWEEN ? AND ? ORDER BY date, category_id, seq`,
      [start, end],
    );
    const items: Record<string, EntryItem[]> = {};
    for (const r of rows.map(toItem)) (items[cellKey(r.date, r.categoryId)] ??= []).push(r);
    const withItems = new Set(rows.map((r) => r.category_id));
    return {
      weekId,
      days: weekDays(weekId),
      categories: visibleCategories(categories, periods, start, end, withItems),
      items,
      note: opts.note === false ? emptyDoc() : (await this.getWeekNote(weekId)).doc,
      ...(await this.dayMarkPair(start, end)),
    };
  }

  private async dayMarkPair(start: DateStr, end: DateStr) {
    const dayMarkInfo = await this.getDayMarkInfo(start, end);
    const dayMarks = Object.fromEntries(Object.entries(dayMarkInfo).map(([d, m]) => [d, m.kind]));
    return { dayMarks, dayMarkInfo };
  }

  // ── 연차·반차 표시(improve-1026-spec 1절) ────────────
  /** 기간의 표시(종류만) — 직접 표시 + 회사 휴일 + 내장 공휴일(F3) */
  async getDayMarks(from: DateStr, to: DateStr): Promise<Record<DateStr, DayMarkKind>> {
    return (await this.dayMarkPair(from, to)).dayMarks;
  }

  /** 기간의 표시(이름·출처 포함): 직접 표시 > 회사 휴일 > 내장 공휴일(설정에서 끈 날은 빠짐) */
  async getDayMarkInfo(from: DateStr, to: DateStr): Promise<Record<DateStr, DayMarkInfo>> {
    const rows = await this.db.select<{ date: string; kind: string; label: string | null }>(
      "SELECT date, kind, label FROM day_mark WHERE date BETWEEN ? AND ? ORDER BY date",
      [from, to],
    );
    const out: Record<DateStr, DayMarkInfo> = {};
    const { holiday } = await this.getSettings();
    for (const [d, h] of Object.entries(resolveHolidays(from, to, holiday)))
      out[d] = { kind: "holiday", label: h.name, source: h.source };
    for (const r of rows)
      if (isDayMarkKind(r.kind)) out[r.date] = { kind: r.kind, label: r.label, source: "user" };
    return out;
  }

  /**
   * 표시 바꾸기. null = 근무(행 삭제). 공휴일·기타 휴가는 이름·사유(label).
   * 내장 공휴일·회사 휴일인 날을 근무로 돌리면 그 날을 설정의 "끈 날짜"에 더한다(F3 — 회사가 쉬지 않는 날)
   */
  async setDayMark(date: DateStr, kind: DayMarkKind | null, label: string | null = null): Promise<void> {
    if (!DATE_RE.test(date)) throw new ValidationError(`날짜 형식 오류: ${date}`);
    if (kind === null) {
      await this.db.execute("DELETE FROM day_mark WHERE date = ?", [date]);
      const { holiday } = await this.getSettings();
      if (resolveHolidays(date, date, holiday)[date])
        await this.updateSettings({ holiday: { off: [...holiday.off, date] } });
      return;
    }
    if (!isDayMarkKind(kind)) throw new ValidationError(`알 수 없는 표시: ${String(kind)}`);
    const l = kind === "holiday" || kind === "other" ? label?.trim().slice(0, LABEL_MAX) || null : null;
    await this.db.execute(
      "INSERT INTO day_mark (date, kind, label, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET kind = excluded.kind, label = excluded.label, updated_at = excluded.updated_at",
      [date, kind, l, this.ts()],
    );
  }

  // ── 업무 태그(improve-1026-spec 4절) ─────────────────
  async listTags(): Promise<Tag[]> {
    return (await this.cached("tags", () => this.readTags())).tags;
  }

  /** 업무별 태그 id(태그 순서대로). 태그가 없는 업무는 키가 없다 */
  async getCategoryTags(): Promise<Record<string, string[]>> {
    return (await this.cached("tags", () => this.readTags())).byCategory;
  }

  private async readTags(): Promise<{ tags: Tag[]; byCategory: Record<string, string[]> }> {
    const tagRows = await this.db.select<{ id: string; name: string; sort_order: number }>(
      "SELECT id, name, sort_order FROM tag ORDER BY sort_order, name",
    );
    const rows = await this.db.select<{ category_id: string; tag_id: string }>(
      `SELECT ct.category_id, ct.tag_id FROM category_tag ct JOIN tag t ON t.id = ct.tag_id
       ORDER BY t.sort_order, t.name`,
    );
    const byCategory: Record<string, string[]> = {};
    for (const r of rows) (byCategory[r.category_id] ??= []).push(r.tag_id);
    return {
      tags: tagRows.map((r) => ({ id: r.id, name: r.name, sortOrder: Number(r.sort_order) })),
      byCategory,
    };
  }

  private async checkTagName(raw: string, exceptId: string | null): Promise<string> {
    const name = normalizeTagName(raw);
    const others = (await this.listTags()).filter((t) => t.id !== exceptId).map((t) => t.name);
    const problem = tagNameProblem(name, others);
    if (problem) throw new ValidationError(problem);
    return name;
  }

  /** 새 태그(맨 끝 순서). 이름은 1~20자, 대소문자 무시 중복 금지 */
  async createTag(raw: string): Promise<Tag> {
    const name = await this.checkTagName(raw, null);
    const [m] = await this.db.select<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM tag");
    const tag: Tag = { id: uuidv7(this.clock().getTime()), name, sortOrder: Number(m?.m ?? 0) + 1 };
    await this.db.execute("INSERT INTO tag (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)", [
      tag.id,
      tag.name,
      tag.sortOrder,
      this.ts(),
    ]);
    return tag;
  }

  async renameTag(id: string, raw: string): Promise<void> {
    const name = await this.checkTagName(raw, id);
    await this.db.execute("UPDATE tag SET name = ? WHERE id = ?", [name, id]);
  }

  /** 태그 지우기 — 모든 업무에서 떨어진다(category_tag는 외래 키로 함께 지워짐) */
  async deleteTag(id: string): Promise<void> {
    await this.db.execute("DELETE FROM tag WHERE id = ?", [id]);
  }

  async reorderTags(idsInOrder: string[]): Promise<void> {
    await this.db.batch(
      idsInOrder.map((id, i) => ({ sql: "UPDATE tag SET sort_order = ? WHERE id = ?", params: [i + 1, id] })),
    );
  }

  /** 업무에 태그 붙이기/떼기(이미 그 상태면 아무 일 없음) */
  async setCategoryTag(categoryId: string, tagId: string, on: boolean): Promise<void> {
    await this.db.execute(
      on
        ? "INSERT OR IGNORE INTO category_tag (category_id, tag_id) VALUES (?, ?)"
        : "DELETE FROM category_tag WHERE category_id = ? AND tag_id = ?",
      [categoryId, tagId],
    );
  }

  // ── 직전 기록 가져오기(improve-1026-spec 3절) ─────────
  /**
   * before보다 앞선 가장 가까운 기록일(4주 안, 종일 연차 제외)과 그날의 내역.
   * categoryIds를 주면 그 업무들만 본다 — 업무 하나(Alt+P)든 보이는 업무 전체(Alt+Shift+P)든 같은 규칙.
   */
  async previousRecord(before: DateStr, categoryIds: string[]): Promise<PreviousRecord | null> {
    if (!DATE_RE.test(before) || categoryIds.length === 0) return null;
    const from = addDays(before, -PREVIOUS_LOOKBACK_DAYS);
    const inCats = categoryIds.map(() => "?").join(", ");
    const [row] = await this.db.select<{ d: string | null }>(
      `SELECT MAX(date) AS d FROM entry_item
       WHERE date >= ? AND date < ? AND category_id IN (${inCats}) AND trim(text) <> '' AND ${NOT_LEAVE}`,
      [from, before, ...categoryIds],
    );
    if (!row?.d) return null;
    const rows = await this.db.select<{
      id: string;
      category_id: string;
      depth: number;
      text: string;
      flagged: number;
      flag_done_at: string | null;
    }>(
      `SELECT id, category_id, depth, text, flagged, flag_done_at FROM entry_item
       WHERE date = ? AND category_id IN (${inCats}) ORDER BY category_id, seq`,
      [row.d, ...categoryIds],
    );
    const cells: PreviousRecord["cells"] = {};
    let excluded = 0;
    for (const id of categoryIds.filter((id) => rows.some((r) => r.category_id === id))) {
      const result = copyablePrevious(
        rows
          .filter((r) => r.category_id === id)
          .map((r) => ({
            id: r.id,
            depth: Number(r.depth) as Depth,
            text: r.text,
            flagged: Number(r.flagged) === 1,
            flagDoneAt: r.flag_done_at,
          })),
      );
      cells[id] = result.items;
      excluded += result.excluded;
    }
    return { date: row.d, cells, ...(excluded ? { excluded } : {}) };
  }

  /** 업무별 직전 기록일과 그날 내역(오늘 뷰 카드의 미리보기, spec 8-2) — 키: 업무 id */
  async previousRecordsByCategory(before: DateStr): Promise<PreviousRecord[]> {
    const dates = await this.previousRecordDates(before);
    const pairs = Object.entries(dates);
    if (!pairs.length) return [];
    const rows = await this.db.select<{
      id: string;
      category_id: string;
      date: string;
      depth: number;
      text: string;
      flagged: number;
      flag_done_at: string | null;
    }>(
      `SELECT id, category_id, date, depth, text, flagged, flag_done_at FROM entry_item WHERE (${pairs.map(() => "(category_id = ? AND date = ?)").join(" OR ")}) ORDER BY category_id, seq`,
      pairs.flat(),
    );
    return pairs.map(([id, date]) => {
      const result = copyablePrevious(
        rows
          .filter((r) => r.category_id === id)
          .map((r) => ({
            id: r.id,
            depth: Number(r.depth) as Depth,
            text: r.text,
            flagged: Number(r.flagged) === 1,
            flagDoneAt: r.flag_done_at,
          })),
      );
      return {
        date,
        cells: { [id]: result.items },
        ...(result.excluded ? { excluded: result.excluded } : {}),
      };
    });
  }

  /** 업무별 직전 기록일(빈 칸의 [10/28(수) 내역 가져오기] 단추용) — 키: 업무 id */
  async previousRecordDates(before: DateStr): Promise<Record<string, DateStr>> {
    if (!DATE_RE.test(before)) return {};
    const rows = await this.db.select<{ category_id: string; d: string }>(
      `SELECT category_id, MAX(date) AS d FROM entry_item
       WHERE date >= ? AND date < ? AND trim(text) <> '' AND ${NOT_LEAVE} GROUP BY category_id`,
      [addDays(before, -PREVIOUS_LOOKBACK_DAYS), before],
    );
    return Object.fromEntries(rows.map((r) => [r.category_id, r.d]));
  }

  // ── 주간 메모(weekly-note-spec 5절) ─────────────────
  /**
   * 그 주의 메모 문서. 저장한 적 없는 주는 예전 요일 메모(day_memo)를 상자 1개로 만들어 보여 준다(legacy).
   * 예전 표는 읽기만 하고 지우지 않는다. 처음 저장하면 week_note로 옮겨지고 그 뒤로는 week_note만 본다.
   */
  async getWeekNote(weekId: WeekId): Promise<{ doc: NoteDoc; legacy: boolean }> {
    const [row] = await this.db.select<{ doc: string }>("SELECT doc FROM week_note WHERE week_id = ?", [
      weekId,
    ]);
    if (row) return { doc: await this.hydrateNote(weekId, parseNoteDoc(row.doc)), legacy: false };
    const { start, end } = weekRange(weekId);
    const memos = await this.db.select<{ date: string; text: string }>(
      "SELECT date, text FROM day_memo WHERE date BETWEEN ? AND ?",
      [start, end],
    );
    const doc = docFromDayMemos(weekId, Object.fromEntries(memos.map((m) => [m.date, m.text])), () =>
      uuidv7(this.clock().getTime()),
    );
    return { doc, legacy: doc.boxes.length > 0 };
  }

  /** 메모 문서 저장(통째로). 비어도 행을 남긴다 — 예전 요일 메모가 다시 보이지 않게 */
  /** Apply only ref changes since the caller's baseline. External copy links survive stale content saves. */
  async saveWeekNote(weekId: WeekId, doc: NoteDoc, baseline?: NoteDoc): Promise<void> {
    if (doc.boxes.some((b) => b.kind === "text" && b.widget))
      throw new ValidationError("라이브 위젯은 주간 보드에 사본으로 변환한 뒤 저장해 주세요.");
    const clean = parseNoteDoc(JSON.stringify(doc));
    const before = baseline ?? (await this.getWeekNote(weekId)).doc;
    const stored = {
      ...clean,
      boxes: clean.boxes.map((b) => {
        const { refs: _refs, ...box } = b;
        void _refs;
        return box;
      }),
    };
    const json = JSON.stringify(stored);
    if (json.length > NOTE_MAX) throw new ValidationError("메모가 너무 큽니다");
    const stmts: SqlStatement[] = [
      {
        sql: "INSERT INTO week_note (week_id, doc, updated_at) VALUES (?, ?, ?) ON CONFLICT(week_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at",
        params: [weekId, json, this.ts()],
      },
    ];
    stmts.push({
      sql: "DELETE FROM note_entry_link WHERE note_week_id = ? AND box_id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?, '$.boxes'))",
      params: [weekId, json],
    });
    const current = await this.noteLinks(weekId);
    for (const box of clean.boxes) {
      const previous = new Set(before.boxes.find((b) => b.id === box.id)?.refs?.map((r) => r.item) ?? []);
      const next = new Set(box.refs?.map((r) => r.item) ?? []);
      const live = new Set(current.filter((r) => r.box_id === box.id).map((r) => r.entry_id));
      for (const id of previous)
        if (!next.has(id)) {
          live.delete(id);
          stmts.push({
            sql: "DELETE FROM note_entry_link WHERE note_week_id = ? AND box_id = ? AND entry_id = ?",
            params: [weekId, box.id, id],
          });
        }
      for (const id of next)
        if (!previous.has(id)) {
          live.add(id);
          stmts.push({
            sql: "INSERT OR IGNORE INTO note_entry_link (note_week_id, box_id, entry_id, created_at) SELECT ?, ?, id, ? FROM entry_item WHERE id = ?",
            params: [weekId, box.id, this.ts(), id],
          });
        }
      if (live.size > LINK_MAX) throw new ValidationError(`메모 연결은 객체당 ${LINK_MAX}개까지 가능합니다.`);
    }
    await this.db.batch(stmts);
  }

  private async noteLinks(weekId: WeekId) {
    return this.db.select<{ box_id: string; entry_id: string }>(
      "SELECT box_id, entry_id FROM note_entry_link WHERE note_week_id = ? ORDER BY created_at, entry_id",
      [weekId],
    );
  }

  private async hydrateNote(weekId: WeekId, doc: NoteDoc): Promise<NoteDoc> {
    const links = await this.noteLinks(weekId);
    return {
      ...doc,
      boxes: doc.boxes.map((b) => {
        const refs = links.filter((r) => r.box_id === b.id).map((r) => ({ item: r.entry_id }));
        return refs.length ? { ...b, refs } : withoutRef(b);
      }),
    };
  }

  /** Global memo badges point to original objects, including objects owned by another week. */
  async linkedMemos(entryIds: string[]) {
    if (!entryIds.length) return [];
    const weekly = await this.db.select<{
      entryId: string;
      weekId: WeekId;
      boxId: string;
      taskCategoryId?: string;
    }>(
      `SELECT entry_id AS entryId,note_week_id AS weekId,box_id AS boxId FROM note_entry_link WHERE entry_id IN (${entryIds.map(() => "?").join(",")}) ORDER BY note_week_id,box_id`,
      entryIds,
    );
    const tasks = await this.db.select<{
      entryId: string;
      weekId: WeekId;
      boxId: string;
      taskCategoryId: string;
    }>(
      `SELECT l.entry_id AS entryId,'' AS weekId,l.box_id AS boxId,b.category_id AS taskCategoryId FROM cabi_entry_link l JOIN cabi_board b ON b.id=l.board_id WHERE l.entry_id IN (${entryIds.map(() => "?").join(",")}) ORDER BY b.category_id,l.box_id`,
      entryIds,
    );
    return [...weekly, ...tasks];
  }

  /** 메모 이미지 넣기 — 문서보다 먼저 쓰고, 문서(자동 저장)가 이 id를 가리킨다 */
  async addNoteAsset(
    weekId: WeekId,
    a: Omit<NoteAsset, "id">,
    thumb?: { mime: string; data: string } | null,
  ): Promise<string> {
    if (!(IMAGE_MIMES as readonly string[]).includes(a.mime))
      throw new ValidationError("지원하지 않는 그림 형식입니다");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(a.data)) throw new ValidationError("그림 데이터가 올바르지 않습니다");
    const bytes =
      Math.floor((a.data.length * 3) / 4) - (a.data.endsWith("==") ? 2 : a.data.endsWith("=") ? 1 : 0);
    if (bytes > NOTE_ASSET_MAX_BYTES) throw new ValidationError("그림이 너무 큽니다");
    const [w, h] = [Math.round(a.width), Math.round(a.height)];
    if (!(w > 0 && h > 0)) throw new ValidationError("그림 크기가 올바르지 않습니다");
    const id = uuidv7(this.clock().getTime());
    const t = thumb && this.checkThumb(thumb) ? thumb : null;
    await this.db.execute(
      "INSERT INTO note_asset (id, week_id, mime, data, width, height, bytes, created_at, thumb, thumb_mime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, weekId, a.mime, a.data, w, h, bytes, this.ts(), t?.data ?? null, t?.mime ?? null],
    );
    return id;
  }

  private checkThumb(t: { mime: string; data: string }): boolean {
    if (!(NOTE_THUMB_MIMES as readonly string[]).includes(t.mime)) return false;
    return /^[A-Za-z0-9+/]+={0,2}$/.test(t.data) && t.data.length <= NOTE_ASSET_MAX_BYTES;
  }

  /** 그 주 이미지 원본 전부(스냅샷·엑셀 — 한 번 그리고 버리는 곳만). 메모 판은 getNoteAssetMeta + getNoteAssetView */
  async getNoteAssets(weekId: WeekId): Promise<NoteAsset[]> {
    return this.db.select<NoteAsset>(
      "SELECT id, mime, data, width, height, bytes FROM note_asset WHERE week_id = ?",
      [weekId],
    );
  }

  /** 그 주 이미지의 크기·형식만(그림 데이터 없음) */
  async getNoteAssetMeta(weekId: WeekId): Promise<NoteAssetMeta[]> {
    return this.db.select<NoteAssetMeta>(
      "SELECT id, mime, width, height, bytes FROM note_asset WHERE week_id = ?",
      [weekId],
    );
  }

  /** 이미지 원본 1장([크게 보기]·[이미지로 저장…]) */
  async getNoteAsset(id: string): Promise<NoteAsset | null> {
    const [row] = await this.db.select<NoteAsset>(
      "SELECT id, mime, data, width, height, bytes FROM note_asset WHERE id = ?",
      [id],
    );
    return row ?? null;
  }

  /** 메모 판에 그릴 사본 1장 — 썸네일이 있으면 썸네일, 없으면 원본 */
  async getNoteAssetView(id: string): Promise<NoteAssetView | null> {
    const [row] = await this.db.select<{ mime: string; data: string; thumb: number }>(
      `SELECT COALESCE(thumb_mime, mime) AS mime, COALESCE(thumb, data) AS data,
              thumb IS NOT NULL AS thumb FROM note_asset WHERE id = ?`,
      [id],
    );
    return row ? { mime: row.mime, data: row.data, thumb: Number(row.thumb) === 1 } : null;
  }

  /** 예전 이미지의 썸네일을 처음 볼 때 채운다(이미 있으면 그대로) */
  async setNoteAssetThumb(id: string, thumb: { mime: string; data: string }): Promise<void> {
    if (!this.checkThumb(thumb)) return;
    await this.db.execute("UPDATE note_asset SET thumb = ?, thumb_mime = ? WHERE id = ? AND thumb IS NULL", [
      thumb.data,
      thumb.mime,
      id,
    ]);
  }

  /**
   * 문서가 더는 가리키지 않는 그 주의 이미지 지우기(DB 안의 행 — 사용자 폴더 파일이 아님, 스펙 5-2).
   * 실행 취소로 되살릴 수 있는 동안은 부르지 않는다(주를 옮기거나 앱을 닫을 때만).
   */
  async pruneNoteAssets(weekId: WeekId, keepIds: string[]): Promise<number> {
    const keep = [...new Set([...keepIds, ...(await this.undoAssetIds(weekId))])];
    const marks = keep.map(() => "?").join(", ");
    const { changes } = await this.db.execute(
      `DELETE FROM note_asset WHERE week_id = ?${keep.length ? ` AND id NOT IN (${marks})` : ""}`,
      [weekId, ...keep],
    );
    return changes;
  }

  /** 설정 > 백업의 용량 표시 */
  async noteAssetStats(): Promise<{ count: number; bytes: number }> {
    const [r] = await this.db.select<{ count: number; bytes: number | null }>(
      "SELECT COUNT(*) AS count, SUM(bytes) AS bytes FROM (SELECT bytes FROM note_asset UNION ALL SELECT bytes FROM cabi_asset)",
    );
    return { count: r?.count ?? 0, bytes: r?.bytes ?? 0 };
  }

  /** 범위 안에서 메모에 글이 있는 주(예전 요일 메모만 있는 주 포함) */
  private async noteWeeks(from: DateStr, to: DateStr): Promise<Set<WeekId>> {
    const [wa, wb] = [weekIdOf(from), weekIdOf(to)];
    const notes = await this.db.select<{ week_id: string; doc: string }>(
      "SELECT week_id, doc FROM week_note WHERE week_id BETWEEN ? AND ?",
      [wa, wb],
    );
    const saved = new Set(notes.map((n) => n.week_id));
    const out = new Set(notes.filter((n) => !isNoteEmpty(parseNoteDoc(n.doc))).map((n) => n.week_id));
    const legacy = await this.db.select<{ date: string }>(
      "SELECT date FROM day_memo WHERE date BETWEEN ? AND ? AND trim(text) <> ''",
      [from, to],
    );
    for (const r of legacy) {
      const w = weekIdOf(r.date);
      if (!saved.has(w)) out.add(w);
    }
    return out;
  }

  // ── 주간 요약(output-spec 2절) ───────────────────────
  /** 자동 집계 입력 — 보드와 같은 표시 규칙(그 주에 보이는 업무, 보드 순서) */
  async getSummaryInput(weekId: WeekId): Promise<SummaryInput> {
    const view = await this.getWeek(weekId);
    return summaryInputOf(view);
  }

  async getWeeklySummary(weekId: WeekId): Promise<WeeklySummary> {
    const [r] = await this.db.select<WeeklySummaryRow>(
      "SELECT ai_text, ai_basis_hash, ai_saved_at, edited_text, edited_basis_hash, edited_at FROM weekly_summary WHERE week_id = ?",
      [weekId],
    );
    return {
      weekId,
      aiText: r?.ai_text ?? null,
      aiBasisHash: r?.ai_basis_hash ?? null,
      aiSavedAt: r?.ai_saved_at ?? null,
      editedText: r?.edited_text ?? null,
      editedBasisHash: r?.edited_basis_hash ?? null,
      editedAt: r?.edited_at ?? null,
    };
  }

  /** 수정본 저장(AI본 열은 건드리지 않는 upsert). basisHash = 근거 자동 집계본의 해시 */
  async saveEdited(weekId: WeekId, text: string, basisHash: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO weekly_summary (week_id, edited_text, edited_basis_hash, edited_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(week_id) DO UPDATE SET edited_text = excluded.edited_text,
         edited_basis_hash = excluded.edited_basis_hash, edited_at = excluded.edited_at`,
      [weekId, text.slice(0, SUMMARY_MAX), basisHash, this.ts()],
    );
  }

  /** 수정본 지우기. 되돌리기용으로 지우기 전 값을 돌려준다 */
  async deleteEdited(weekId: WeekId): Promise<WeeklySummary> {
    const prev = await this.getWeeklySummary(weekId);
    await this.db.execute(
      "UPDATE weekly_summary SET edited_text = NULL, edited_basis_hash = NULL, edited_at = NULL WHERE week_id = ?",
      [weekId],
    );
    return prev;
  }

  /** 지운 수정본 되살리기(시각까지 그대로) */
  async restoreEdited(prev: WeeklySummary): Promise<void> {
    if (prev.editedText === null) return;
    await this.db.execute(
      `INSERT INTO weekly_summary (week_id, edited_text, edited_basis_hash, edited_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(week_id) DO UPDATE SET edited_text = excluded.edited_text,
         edited_basis_hash = excluded.edited_basis_hash, edited_at = excluded.edited_at`,
      [prev.weekId, prev.editedText, prev.editedBasisHash, prev.editedAt],
    );
  }

  // ── 엑셀 내보내기(output-spec 3·4절) ─────────────────
  /** 기록(항목·메모)이 있는 가장 이른 주. 없으면 null — "전체" 범위의 시작 */
  async firstRecordWeek(): Promise<WeekId | null> {
    const [r] = await this.db.select<{ d: string | null }>(
      "SELECT MIN(date) AS d FROM entry_item WHERE trim(text) <> ''",
    );
    const firstItem = r?.d ? weekIdOf(r.d) : null;
    const notes = [...(await this.noteWeeks("0001-01-01", "9999-12-31"))].sort();
    const firstNote = notes[0] ?? null;
    if (!firstItem) return firstNote;
    return firstNote && firstNote < firstItem ? firstNote : firstItem;
  }

  /** 내보내기 대화상자의 미리 계산: 주 수 · 기록이 있는 업무 수 · 항목 수(메모 제외) */
  async exportStats(from: WeekId, to: WeekId): Promise<{ weeks: number; categories: number; items: number }> {
    const start = weekStart(from);
    const end = weekRange(to).end;
    const [r] = await this.db.select<{ items: number; categories: number }>(
      "SELECT COUNT(*) AS items, COUNT(DISTINCT category_id) AS categories FROM entry_item WHERE date BETWEEN ? AND ? AND trim(text) <> ''",
      [start, end],
    );
    return {
      weeks: weekList(from, to).length,
      categories: Number(r?.categories ?? 0),
      items: Number(r?.items ?? 0),
    };
  }

  /** 내보낼 주별 자료(오래된 주부터): 자동 집계 입력 · 업무 색 · 저장된 본 */
  async exportWeeks(from: WeekId, to: WeekId): Promise<ExportWeek[]> {
    const out: ExportWeek[] = [];
    for (const weekId of weekList(from, to)) {
      const view = await this.getWeek(weekId);
      const saved = await this.getWeeklySummary(weekId);
      out.push({
        input: summaryInputOf(view),
        colors: Object.fromEntries(view.categories.map((v) => [v.category.id, v.category.color])),
        summary: { editedText: saved.editedText, aiText: saved.aiText },
      });
    }
    return out;
  }

  /**
   * 셀 하나를 통째로 저장(data-spec 8-1): 목록에서 빠진 항목 삭제 + 나머지 id 기준 upsert, 한 트랜잭션.
   * 추가·수정·삭제·순서·깊이 변경이 모두 이 한 경로를 지난다. 저장된 항목을 돌려준다.
   */
  async saveCell(date: DateStr, categoryId: string, drafts: ItemDraft[]): Promise<EntryItem[]> {
    const { stmts, items } = this.cellStatements(date, categoryId, drafts);
    await this.db.batch(this.withBoardCtx(stmts));
    return items;
  }

  /**
   * 여러 칸을 한 batch로(improve-1026v2-spec 3-4, 행 끌어서 옮기기). **받는 칸을 먼저** 넘긴다 —
   * 같은 id의 upsert가 행의 날짜·업무를 바꾸므로, 그다음 원래 칸의 "목록에 없는 행 삭제"가 옮겨 간 행을 지우지 않는다
   * (순서가 바뀌면 지웠다 새로 만들어 처리 완료 기록·가져오기 묶음 등이 사라진다).
   */
  async saveCells(cells: { date: DateStr; categoryId: string; items: ItemDraft[] }[]): Promise<void> {
    const stmts = cells.flatMap((c) => this.cellStatements(c.date, c.categoryId, c.items).stmts);
    await this.db.batch(this.withBoardCtx(stmts));
  }

  /** 주간 보드 저장도 상태 이력의 출처·시각을 맞춘다(improve-v21-spec 4절) */
  private withBoardCtx(stmts: SqlStatement[]): SqlStatement[] {
    const { begin, end } = this.kanban.ctxStatements("board");
    return [begin, ...stmts, end];
  }

  async itemRelations(ids: string[]): Promise<ItemRelations> {
    if (!ids.length) return { notes: [], cabinet: [] };
    const marks = ids.map(() => "?").join(",");
    const [notes, cabinet, taskNotes] = await Promise.all([
      this.db.select<ItemRelations["notes"][number]>(
        `SELECT * FROM note_entry_link WHERE entry_id IN (${marks})`,
        ids,
      ),
      this.db.select<ItemRelations["cabinet"][number]>(
        `SELECT id, item_id, entry_id, created_at FROM cabinet_link WHERE entry_id IN (${marks})`,
        ids,
      ),
      this.db.select<NonNullable<ItemRelations["taskNotes"]>[number]>(
        `SELECT board_id,box_id,entry_id FROM cabi_entry_link WHERE entry_id IN (${marks})`,
        ids,
      ),
    ]);
    return { notes, cabinet, ...(taskNotes.length ? { taskNotes } : {}) };
  }

  private relationStatements(links: ItemRelations, strict = false): SqlStatement[] {
    return [
      ...(links.taskNotes ?? []).map((r) => ({
        sql: strict
          ? "INSERT INTO cabi_entry_link(board_id,box_id,entry_id) VALUES(?,?,?)"
          : "INSERT OR IGNORE INTO cabi_entry_link(board_id,box_id,entry_id) SELECT ?,?,e.id FROM entry_item e WHERE e.id=? AND EXISTS(SELECT 1 FROM cabi_board n,json_each(n.doc,'$.boxes') b WHERE n.id=? AND json_extract(b.value,'$.id')=?)",
        params: strict
          ? [r.board_id, r.box_id, r.entry_id]
          : [r.board_id, r.box_id, r.entry_id, r.board_id, r.box_id],
      })),

      ...links.notes.map((r) => ({
        sql: strict
          ? "INSERT INTO note_entry_link (note_week_id, box_id, created_at, entry_id) VALUES (?, ?, ?, ?)"
          : `INSERT OR IGNORE INTO note_entry_link (note_week_id, box_id, entry_id, created_at)
        SELECT ?, ?, e.id, ? FROM entry_item e WHERE e.id = ? AND EXISTS
        (SELECT 1 FROM week_note n, json_each(n.doc, '$.boxes') b WHERE n.week_id = ? AND json_extract(b.value, '$.id') = ?)`,
        params: strict
          ? [r.note_week_id, r.box_id, r.created_at, r.entry_id]
          : [r.note_week_id, r.box_id, r.created_at, r.entry_id, r.note_week_id, r.box_id],
      })),
      ...links.cabinet.map((r) => ({
        sql: strict
          ? "INSERT INTO cabinet_link (id, item_id, entry_id, created_at) VALUES (?, ?, ?, ?)"
          : `INSERT OR IGNORE INTO cabinet_link (id, item_id, entry_id, created_at)
        SELECT ?, c.id, e.id, ? FROM cabinet_item c, entry_item e WHERE c.id = ? AND e.id = ?`,
        params: strict
          ? [r.id, r.item_id, r.entry_id, r.created_at]
          : [r.id, r.created_at, r.item_id, r.entry_id],
      })),
    ];
  }

  async restoreItemRelations(links: ItemRelations): Promise<void> {
    await this.db.batch(this.relationStatements(links));
  }

  private serializeCopy<T>(work: () => Promise<T>): Promise<T> {
    const result = this.copyQueue.then(work);
    this.copyQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Only change ordering on existing rows; a copy never overwrites their text/metadata or deletes them. */
  private copiedStatements(cells: CopiedEntries["cells"], ids: Set<string>): SqlStatement[] {
    return cells.flatMap((c) =>
      this.cellStatements(c.date, c.categoryId, c.items)
        .stmts.slice(1)
        .map((st) =>
          ids.has(String(st.params?.[0]))
            ? { ...st, sql: st.sql.split("ON CONFLICT(id)")[0]! }
            : {
                sql: "UPDATE entry_item SET seq = ? WHERE id = ? AND date = ? AND category_id = ?",
                params: [st.params![3]!, st.params![0]!, c.date, c.categoryId],
              },
        ),
    );
  }

  /** Atomic additions only: source objects are shared; no existing item/content is replaced. */
  async copyEntries(
    cells: CopiedEntries["cells"],
    mapping: { source: string; target: string }[],
  ): Promise<CopiedEntries> {
    return this.serializeCopy(() => this.performCopyEntries(cells, mapping));
  }

  private async performCopyEntries(
    cells: CopiedEntries["cells"],
    mapping: { source: string; target: string }[],
  ): Promise<CopiedEntries> {
    if (new Set(mapping.map((m) => m.target)).size !== mapping.length)
      throw new ValidationError("복제 항목 ID가 중복됩니다.");
    const additions = cells.map((c) => ({
      ...c,
      items: c.items.filter((i) => mapping.some((m) => m.target === i.id)),
    }));
    const { categories, periods } = await this.listCategories();
    for (const cell of additions) {
      const range = weekRange(weekIdOf(cell.date));
      if (
        !visibleCategories(categories, periods, range.start, range.end, new Set()).some(
          (c) => c.category.id === cell.categoryId,
        )
      )
        throw new ValidationError("대상 주에 표시되지 않는 업무입니다. 업무를 재활성한 후 복제해 주세요.");
    }
    const sourceIds = [...new Set(mapping.map((m) => m.source))];
    const sources = await this.getItemsByIds(sourceIds);
    if (sources.length !== sourceIds.length)
      throw new ValidationError("원본 항목이 변경되었습니다. 다시 선택해 주세요.");
    if ((await this.getItemsByIds(mapping.map((m) => m.target))).length)
      throw new ValidationError("이미 복제한 항목입니다.");
    for (const pair of mapping) {
      const source = sources.find((i) => i.id === pair.source);
      const target = additions.flatMap((c) => c.items).find((i) => i.id === pair.target);
      if (!target || !source || target.text !== source.text)
        throw new ValidationError("원본 항목이 변경되었습니다. 다시 선택해 주세요.");
    }
    const original = await this.itemRelations(sourceIds);
    const relations: ItemRelations = { notes: [], cabinet: [] };
    for (const m of mapping) {
      if (original.taskNotes?.length)
        (relations.taskNotes ??= []).push(
          ...original.taskNotes
            .filter((r) => r.entry_id === m.source)
            .map((r) => ({ ...r, entry_id: m.target })),
        );
      relations.notes.push(
        ...original.notes
          .filter((r) => r.entry_id === m.source)
          .map((r) => ({ ...r, entry_id: m.target, created_at: this.ts() })),
      );
      relations.cabinet.push(
        ...original.cabinet
          .filter((r) => r.entry_id === m.source)
          .map((r) => ({ ...r, id: uuidv7(), entry_id: m.target, created_at: this.ts() })),
      );
    }
    for (const note of relations.notes) {
      const [count] = await this.db.select<{ n: number }>(
        "SELECT COUNT(*) AS n FROM note_entry_link WHERE note_week_id = ? AND box_id = ?",
        [note.note_week_id, note.box_id],
      );
      const added = relations.notes.filter(
        (r) => r.note_week_id === note.note_week_id && r.box_id === note.box_id,
      ).length;
      if (Number(count?.n ?? 0) + added > LINK_MAX) {
        const box = (await this.getWeekNote(note.note_week_id)).doc.boxes.find((b) => b.id === note.box_id);
        const name = box ? boxName(box).slice(0, 40) : "연결된 메모";
        throw new ValidationError(
          `메모 ‘${name}’의 예상 연결 ${Number(count?.n ?? 0) + added}개가 한도 ${LINK_MAX}개를 넘습니다. 연결을 정리한 후 다시 시도해 주세요.`,
        );
      }
    }
    for (const cell of cells) {
      const old = await this.getCategoryEntries(cell.categoryId, cell.date, cell.date);
      if (old.some((i) => !cell.items.some((j) => j.id === i.id)))
        throw new ValidationError("대상 기록이 변경되었습니다. 다시 시도해 주세요.");
    }
    // Cell diffs may insert children among existing rows; existing IDs remain intact.
    const statements = this.copiedStatements(cells, new Set(mapping.map((m) => m.target)));
    await this.db.batch([...statements, ...this.relationStatements(relations, true)]);
    const placements: Record<string, string | null> = {};
    for (const cell of cells)
      cell.items.forEach((item, index) => {
        if (mapping.some((m) => m.target === item.id))
          placements[item.id] = cell.items[index - 1]?.id ?? null;
      });
    return { cells: additions, relations, placements };
  }

  async undoCopiedEntries(copy: CopiedEntries): Promise<void> {
    return this.serializeCopy(() => this.performUndoCopy(copy));
  }
  private async performUndoCopy(copy: CopiedEntries): Promise<void> {
    const ids = copy.cells.flatMap((c) => c.items.map((i) => i.id));
    if (ids.length)
      await this.db.batch(ids.map((id) => ({ sql: "DELETE FROM entry_item WHERE id = ?", params: [id] })));
  }

  async redoCopiedEntries(copy: CopiedEntries): Promise<void> {
    return this.serializeCopy(() => this.performRedoCopy(copy));
  }
  private async performRedoCopy(copy: CopiedEntries): Promise<void> {
    const cells: CopiedEntries["cells"] = [];
    for (const c of copy.cells) {
      const existing = await this.getCategoryEntries(c.categoryId, c.date, c.date);
      if (existing.some((e) => c.items.some((i) => i.id === e.id)))
        throw new ValidationError("복제 항목이 이미 존재합니다.");
      const items: ItemDraft[] = [...existing];
      for (const item of c.items) {
        const anchor = copy.placements[item.id];
        const index = anchor ? items.findIndex((i) => i.id === anchor) : -1;
        const at = anchor === null ? 0 : index >= 0 ? index + 1 : items.length;
        items.splice(at, 0, index < 0 && item.depth === 1 ? { ...item, depth: 0 } : item);
      }
      cells.push({ ...c, items });
    }
    await this.db.batch([
      ...this.copiedStatements(cells, new Set(copy.cells.flatMap((c) => c.items.map((i) => i.id)))),
      ...this.relationStatements(copy.relations),
    ]);
  }

  private cellStatements(
    date: DateStr,
    categoryId: string,
    drafts: ItemDraft[],
  ): { stmts: SqlStatement[]; items: EntryItem[] } {
    if (!DATE_RE.test(date)) throw new ValidationError(`날짜 형식 오류: ${date}`);
    const items: EntryItem[] = normalizeCell(drafts).map((d, i) => ({
      id: d.id,
      date,
      categoryId,
      seq: i + 1,
      depth: d.depth,
      text: d.text.slice(0, 2000),
      flagged: d.flagged === true,
      flagDoneAt: d.flagged ? null : (d.flagDoneAt ?? null),
      completionWasFlagged: d.completionWasFlagged ?? true,
      recurrenceId: d.recurrenceId ?? null,
      startTime: isStartTime(d.startTime) ? d.startTime : null,
      dueDate: isDueDate(d.dueDate) ? d.dueDate : null,
    }));
    const ids = items.map((i) => i.id);
    const ts = this.ts();
    const stmts: SqlStatement[] = [
      {
        sql:
          "DELETE FROM entry_item WHERE date = ? AND category_id = ?" +
          (ids.length ? ` AND id NOT IN (${ids.map(() => "?").join(", ")})` : ""),
        params: [date, categoryId, ...ids],
      },
      ...items.map((it) => ({
        sql: `INSERT INTO entry_item (id, date, category_id, seq, depth, text, flagged, flag_done_at, completion_was_flagged, recurrence_id,
                                      start_time, due_date, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                date = excluded.date, category_id = excluded.category_id, seq = excluded.seq,
                depth = excluded.depth, text = excluded.text, flagged = excluded.flagged,
                flag_done_at = excluded.flag_done_at, completion_was_flagged = excluded.completion_was_flagged, recurrence_id = excluded.recurrence_id,
                start_time = excluded.start_time, due_date = excluded.due_date,
                updated_at = CASE WHEN entry_item.text <> excluded.text OR entry_item.depth <> excluded.depth
                                    OR entry_item.seq <> excluded.seq OR entry_item.date <> excluded.date
                                    OR entry_item.category_id <> excluded.category_id
                                    OR entry_item.flagged <> excluded.flagged
                                  THEN excluded.updated_at ELSE entry_item.updated_at END`,
        params: [
          it.id,
          it.date,
          it.categoryId,
          it.seq,
          it.depth,
          it.text,
          it.flagged ? 1 : 0,
          it.flagDoneAt ?? null,
          it.completionWasFlagged === false ? 0 : 1,
          it.recurrenceId ?? null,
          it.startTime ?? null,
          it.dueDate ?? null,
          ts,
          ts,
        ],
      })),
    ];
    return { stmts, items };
  }

  // ── 중요 업무(important-repeat-spec 2절) ──────────────
  private async importantRows(where: string, params: SqlParam[]): Promise<ImportantItem[]> {
    const rows = await this.db.select<ImportantRow>(
      `SELECT e.id, e.date, e.category_id, e.seq, e.depth, e.text, e.flagged, e.flag_done_at, e.completion_was_flagged, e.recurrence_id,
              e.start_time, e.due_date, c.name AS category_name, c.color AS category_color, c.sort_order AS category_order,
              CASE WHEN e.depth = 1 THEN (
                SELECT p.text FROM entry_item p
                WHERE p.date = e.date AND p.category_id = e.category_id AND p.depth = 0 AND p.seq < e.seq
                ORDER BY p.seq DESC LIMIT 1) END AS parent_text
       FROM entry_item e JOIN category c ON c.id = e.category_id
       WHERE ${where}`,
      params,
    );
    const { periods } = await this.listCategories();
    const groups = groupPeriods(periods);
    return rows.map((r) => ({
      id: r.id,
      date: r.date,
      categoryId: r.category_id,
      categoryName: r.category_name,
      categoryColor: r.category_color,
      categoryOrder: Number(r.category_order),
      categoryEnded: !openPeriod(groups.get(r.category_id) ?? []),
      seq: Number(r.seq),
      depth: Number(r.depth) as Depth,
      text: r.text,
      parentText: r.parent_text,
      flagDoneAt: r.flag_done_at,
      startTime: r.start_time ?? null,
      dueDate: r.due_date ?? null,
    }));
  }

  /**
   * id로 항목 찾기(주와 상관없이) — 메모 상자 연결 띠가 다른 주로 옮긴 항목을 보여 줄 때(improve-1103v8-spec D5).
   * 없는 id는 빠진다
   */
  async getItemsByIds(
    ids: string[],
  ): Promise<(EntryItem & { categoryName: string; categoryColor: string })[]> {
    const out: (EntryItem & { categoryName: string; categoryColor: string })[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      if (!part.length) continue;
      const rows = await this.db.select<ItemRow & { category_name: string; category_color: string }>(
        `SELECT e.id, e.date, e.category_id, e.seq, e.depth, e.text, e.flagged, e.flag_done_at, e.completion_was_flagged, e.recurrence_id,
                e.start_time, e.due_date, c.name AS category_name, c.color AS category_color
         FROM entry_item e JOIN category c ON c.id = e.category_id
         WHERE e.id IN (${part.map(() => "?").join(", ")})`,
        part,
      );
      out.push(
        ...rows.map((r) => ({
          ...toItem(r),
          categoryName: r.category_name,
          categoryColor: r.category_color,
        })),
      );
    }
    return out;
  }

  /** 아직 처리하지 않은 중요 항목 전부(모든 주). 묶음·정렬은 domain/important.ts */
  async listImportant(): Promise<ImportantItem[]> {
    // 사용자 칸반 섹션에 둔 항목은 빠진다(★는 유지 — improve-v21-spec D3)
    return this.importantRows("e.flagged = 1 AND e.kanban_section_id IS NULL", []);
  }

  /**
   * 그 주에 처리 완료한 중요 항목(improve-1027v4-spec 3·4절) — 완료 기록은 영구 보관, "그 주" = 처리한 날(내 PC 날짜)이
   * 그 주의 월~일. 완료 시각은 UTC ISO로 저장돼 있어 그 주 월요일 0시~다음 월요일 0시(로컬)를 UTC로 바꿔 거른다. 최근 순.
   */
  async listDoneInWeek(weekId: WeekId): Promise<ImportantItem[]> {
    const start = parseDate(weekStart(weekId));
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    const rows = await this.importantRows(
      "e.flagged = 0 AND e.completion_was_flagged = 1 AND e.flag_done_at IS NOT NULL AND e.flag_done_at >= ? AND e.flag_done_at < ?",
      [utcTimestamp(start), utcTimestamp(end)],
    );
    return rows.sort((a, b) => (b.flagDoneAt ?? "").localeCompare(a.flagDoneAt ?? ""));
  }

  /**
   * 처리 완료: 강조 해제 + 완료 시각 기록 + 딸린 세부 항목도 함께 완료(improve-v21-spec D4) + 칸반 섹션 표시 지움.
   * 주간 보드·중요 업무 목록·칸반이 같은 규칙을 쓴다. `children` = 함께 완료한 세부 항목 id
   */
  async completeFlag(
    id: string,
    source: "board" | "important" | "kanban" = "board",
  ): Promise<{ wasImportant: boolean; at: string; children: string[] } | null> {
    const ts = this.ts();
    const kids = await this.kanban.childIds(id);
    const [before] = await this.db.select<{ depth: number }>("SELECT depth FROM entry_item WHERE id = ?", [
      id,
    ]);
    const children = before && Number(before.depth) === 0 ? kids : [];
    const open =
      children.length > 0
        ? await this.db.select<{ id: string }>(
            `SELECT id FROM entry_item WHERE id IN (${children.map(() => "?").join(", ")}) AND NOT (flagged = 0 AND flag_done_at IS NOT NULL)`,
            children,
          )
        : [];
    const { begin, end } = this.kanban.ctxStatements(source);
    await this.db.batch([
      begin,
      ...this.kanban.completeStatements(
        id,
        open.map((r) => r.id),
        ts,
      ),
      end,
    ]);
    const [row] = await this.db.select<{ completion_was_flagged: number; flag_done_at: string | null }>(
      "SELECT completion_was_flagged, flag_done_at FROM entry_item WHERE id = ?",
      [id],
    );
    return row?.flag_done_at
      ? {
          wasImportant: row.completion_was_flagged !== 0,
          at: row.flag_done_at,
          children: open.map((r) => r.id),
        }
      : null;
  }

  /** 완료 전 중요 표시를 복원한다(일반 항목이면 별표를 만들지 않는다). 함께 완료된 세부 항목도 되살린다(D7) */
  async undoComplete(id: string, source: "board" | "important" | "kanban" = "board"): Promise<boolean> {
    const [row] = await this.db.select<{
      completion_was_flagged: number;
      flag_done_at: string | null;
      depth: number;
    }>("SELECT completion_was_flagged, flag_done_at, depth FROM entry_item WHERE id = ?", [id]);
    const important = row?.completion_was_flagged !== 0;
    const children = row && Number(row.depth) === 0 && row.flag_done_at ? await this.kanban.childIds(id) : [];
    const { begin, end } = this.kanban.ctxStatements(source);
    await this.db.batch([
      begin,
      ...(row?.flag_done_at
        ? this.kanban.reopenStatements(id, children, row.flag_done_at, null)
        : [
            {
              sql: "UPDATE entry_item SET flagged = completion_was_flagged, flag_done_at = NULL, updated_at = ? WHERE id = ?",
              params: [this.ts(), id],
            },
          ]),
      end,
    ]);
    return important;
  }

  // ── 매주 반복(important-repeat-spec 3절) ───────────────
  async listRecurrences(): Promise<Recurrence[]> {
    return this.cached("recurrences", () => this.readRecurrences());
  }

  private async readRecurrences(): Promise<Recurrence[]> {
    const rules = await this.db.select<RecurrenceRow>(
      "SELECT id, category_id, weekday, start_week, end_week, flag_on_create, created_at FROM recurrence ORDER BY weekday, created_at",
    );
    const lines = await this.db.select<{ recurrence_id: string; depth: number; text: string }>(
      "SELECT recurrence_id, depth, text FROM recurrence_line ORDER BY recurrence_id, seq",
    );
    return rules.map((r) => ({
      id: r.id,
      categoryId: r.category_id,
      weekday: Number(r.weekday),
      startWeek: r.start_week,
      endWeek: r.end_week,
      flagOnCreate: Number(r.flag_on_create) === 1,
      lines: lines
        .filter((l) => l.recurrence_id === r.id)
        .map((l) => ({ depth: Number(l.depth) as Depth, text: l.text })),
    }));
  }

  private ruleInsert(rule: Recurrence, createdAt: string, updatedAt: string): SqlStatement[] {
    return [
      {
        sql: "INSERT INTO recurrence (id, category_id, weekday, start_week, end_week, flag_on_create, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params: [
          rule.id,
          rule.categoryId,
          rule.weekday,
          rule.startWeek,
          rule.endWeek,
          rule.flagOnCreate ? 1 : 0,
          createdAt,
          updatedAt,
        ],
      },
      ...rule.lines.map((l, i) => ({
        sql: "INSERT INTO recurrence_line (recurrence_id, seq, depth, text) VALUES (?, ?, ?, ?)",
        params: [rule.id, i + 1, l.depth, l.text],
      })),
    ];
  }

  /** 규칙 지우기: 항목 연결을 풀고 줄·만든 주·규칙을 지운다(외래 키 연쇄 삭제에 기대지 않고 직접) */
  private ruleDelete(id: string): SqlStatement[] {
    return [
      { sql: "UPDATE entry_item SET recurrence_id = NULL WHERE recurrence_id = ?", params: [id] },
      { sql: "DELETE FROM recurrence_line WHERE recurrence_id = ?", params: [id] },
      { sql: "DELETE FROM recurrence_week WHERE recurrence_id = ?", params: [id] },
      { sql: "DELETE FROM recurrence WHERE id = ?", params: [id] },
    ];
  }

  /**
   * 항목 묶음(본 항목 + 세부 항목, 저장된 id 순서대로)에서 반복을 켠다.
   * 요일 = 그 날짜의 요일, 시작 = 다음 주. 원래 항목도 반복에 연결하고 그 주는 "이미 만든 주"로 둔다.
   */
  async enableRepeat(itemIds: string[], flagOnCreate: boolean): Promise<Recurrence> {
    if (itemIds.length === 0) throw new ValidationError("반복할 항목이 없습니다");
    const rows = await this.db.select<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM entry_item WHERE id IN (${itemIds.map(() => "?").join(", ")}) ORDER BY seq`,
      itemIds,
    );
    const first = rows[0];
    if (!first) throw new ValidationError("저장되지 않은 항목은 반복할 수 없습니다");
    const { weekday, startWeek, originWeek } = ruleTiming(first.date);
    const lines: RecurrenceLine[] = rows.map((r, i) => ({
      depth: (i === 0 ? 0 : Number(r.depth)) as Depth,
      text: r.text,
    }));
    const rule: Recurrence = {
      id: uuidv7(),
      categoryId: first.category_id,
      weekday,
      startWeek,
      endWeek: null,
      flagOnCreate,
      lines,
    };
    const ts = this.ts();
    await this.db.batch([
      ...this.ruleInsert(rule, ts, ts),
      {
        sql: `UPDATE entry_item SET recurrence_id = ? WHERE id IN (${rows.map(() => "?").join(", ")})`,
        params: [rule.id, ...rows.map((r) => r.id)],
      },
      {
        sql: "INSERT INTO recurrence_week (recurrence_id, week_id, created_at) VALUES (?, ?, ?)",
        params: [rule.id, originWeek, ts],
      },
    ]);
    return rule;
  }

  /**
   * 반복 끄기: 항목이 있는 주(atWeek)까지만 하고 멈춘다. 한 번도 새로 만든 적 없으면 규칙째 지운다.
   * 이미 들어온 기록은 지우지 않는다. 되돌리기 정보를 돌려준다.
   */
  async disableRepeat(ruleId: string, atWeek: WeekId): Promise<RepeatUndo> {
    const rule = (await this.listRecurrences()).find((r) => r.id === ruleId);
    if (!rule) throw new ValidationError("반복 항목을 찾을 수 없습니다");
    const made = await this.db.select<{ week_id: string; created_at: string }>(
      "SELECT week_id, created_at FROM recurrence_week WHERE recurrence_id = ?",
      [ruleId],
    );
    const ts = this.ts();
    if (!made.some((m) => m.week_id >= rule.startWeek)) {
      const [meta] = await this.db.select<{ created_at: string }>(
        "SELECT created_at FROM recurrence WHERE id = ?",
        [ruleId],
      );
      const linked = await this.db.select<{ id: string }>(
        "SELECT id FROM entry_item WHERE recurrence_id = ?",
        [ruleId],
      );
      await this.db.batch([...this.ruleDelete(ruleId)]);
      return {
        kind: "deleted",
        rule,
        createdAt: meta?.created_at ?? ts,
        madeWeeks: made,
        itemIds: linked.map((r) => r.id),
      };
    }
    await this.db.execute("UPDATE recurrence SET end_week = ?, updated_at = ? WHERE id = ?", [
      atWeek,
      ts,
      ruleId,
    ]);
    return { kind: "ended", ruleId, prevEnd: rule.endWeek };
  }

  /** 반복 끄기 되돌리기 */
  async restoreRepeat(undo: RepeatUndo): Promise<void> {
    const ts = this.ts();
    if (undo.kind === "ended") {
      await this.db.execute("UPDATE recurrence SET end_week = ?, updated_at = ? WHERE id = ?", [
        undo.prevEnd,
        ts,
        undo.ruleId,
      ]);
      return;
    }
    await this.db.batch([
      ...this.ruleInsert(undo.rule, undo.createdAt, ts),
      ...undo.madeWeeks.map((m) => ({
        sql: "INSERT INTO recurrence_week (recurrence_id, week_id, created_at) VALUES (?, ?, ?)",
        params: [undo.rule.id, m.week_id, m.created_at],
      })),
      ...(undo.itemIds.length
        ? [
            {
              sql: `UPDATE entry_item SET recurrence_id = ? WHERE id IN (${undo.itemIds.map(() => "?").join(", ")})`,
              params: [undo.rule.id, ...undo.itemIds],
            },
          ]
        : []),
    ]);
  }

  /** 설정 > 반복 항목: 문구(본 항목)·중요로 시작·중지(끝 주)/다시 시작(null) */
  async updateRecurrence(
    id: string,
    patch: { text?: string; flagOnCreate?: boolean; endWeek?: WeekId | null },
  ): Promise<void> {
    const ts = this.ts();
    const stmts: SqlStatement[] = [];
    if (patch.text !== undefined) {
      const text = patch.text.trim().slice(0, 2000);
      if (!text) throw new ValidationError("반복 문구를 비울 수 없습니다");
      stmts.push({
        sql: "UPDATE recurrence_line SET text = ? WHERE recurrence_id = ? AND seq = 1",
        params: [text, id],
      });
    }
    if (patch.flagOnCreate !== undefined) {
      stmts.push({
        sql: "UPDATE recurrence SET flag_on_create = ? WHERE id = ?",
        params: [patch.flagOnCreate ? 1 : 0, id],
      });
    }
    if (patch.endWeek !== undefined) {
      stmts.push({ sql: "UPDATE recurrence SET end_week = ? WHERE id = ?", params: [patch.endWeek, id] });
    }
    if (!stmts.length) return;
    stmts.push({ sql: "UPDATE recurrence SET updated_at = ? WHERE id = ?", params: [ts, id] });
    await this.db.batch(stmts);
  }

  /** 규칙만 지운다. 이미 들어온 기록은 남고 ↻ 연결만 풀린다(spec 3-5) */
  async deleteRecurrence(id: string): Promise<void> {
    await this.db.batch(this.ruleDelete(id));
  }

  private async pendingRules(weekId: WeekId): Promise<Recurrence[]> {
    const rules = await this.listRecurrences();
    if (!rules.length) return [];
    const made = await this.db.select<{ recurrence_id: string }>(
      "SELECT recurrence_id FROM recurrence_week WHERE week_id = ?",
      [weekId],
    );
    const { periods } = await this.listCategories();
    return rulesToCreate(rules, weekId, new Set(made.map((m) => m.recurrence_id)), groupPeriods(periods));
  }

  /**
   * 반복 항목을 그 주에 넣는다(한 트랜잭션). 칸 맨 아래에 붙이고 그 주를 "이미 만든 주"로 기록한다.
   * 이번 주는 보드를 열 때 자동으로, 미래 주는 "예정"을 눌렀을 때 그 규칙만(onlyRuleId). 만든 묶음 수를 돌려준다.
   */
  async materializeWeek(weekId: WeekId, onlyRuleId?: string): Promise<number> {
    const targets = (await this.pendingRules(weekId)).filter((r) => !onlyRuleId || r.id === onlyRuleId);
    if (!targets.length) return 0;
    const ts = this.ts();
    const stmts: SqlStatement[] = [];
    const nextSeq = new Map<string, number>();
    for (const rule of targets) {
      const date = ruleDate(rule, weekId);
      const key = cellKey(date, rule.categoryId);
      if (!nextSeq.has(key)) {
        const [row] = await this.db.select<{ m: number | null }>(
          "SELECT MAX(seq) AS m FROM entry_item WHERE date = ? AND category_id = ?",
          [date, rule.categoryId],
        );
        nextSeq.set(key, Number(row?.m ?? 0) + 1);
      }
      rule.lines.forEach((line, i) => {
        const seq = nextSeq.get(key)!;
        nextSeq.set(key, seq + 1);
        stmts.push({
          sql: `INSERT INTO entry_item (id, date, category_id, seq, depth, text, flagged, recurrence_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            uuidv7(),
            date,
            rule.categoryId,
            seq,
            line.depth,
            line.text,
            i === 0 && rule.flagOnCreate ? 1 : 0,
            rule.id,
            ts,
            ts,
          ],
        });
      });
      stmts.push({
        sql: "INSERT INTO recurrence_week (recurrence_id, week_id, created_at) VALUES (?, ?, ?)",
        params: [rule.id, weekId, ts],
      });
    }
    await this.db.batch(stmts);
    return targets.length;
  }

  /** 미래 주의 반복 "예정"(저장하지 않음) */
  async previewWeek(weekId: WeekId): Promise<RepeatPreview[]> {
    return (await this.pendingRules(weekId)).map((rule) => ({ rule, date: ruleDate(rule, weekId) }));
  }

  // ── 무기록 종료 제안 ────────────────────────────────
  async getNudges(currentWeek: WeekId = this.currentWeek()): Promise<string[]> {
    const settings = await this.getSettings();
    if (settings.nudgeWeeks <= 0) return [];
    const from = weekStart(addWeeks(currentWeek, -NUDGE_LOOKBACK_WEEKS));
    const to = weekRange(currentWeek).end;
    // 반복으로 자동 생성되고 한 번도 고치지 않은 항목은 기록으로 세지 않는다(spec 6절)
    const raw = await this.db.select<{
      category_id: string;
      date: string;
      recurrence_id: string | null;
      untouched: number;
    }>(
      "SELECT DISTINCT category_id, date, recurrence_id, created_at = updated_at AS untouched FROM entry_item WHERE date BETWEEN ? AND ?",
      [from, to],
    );
    const startWeeks = new Map((await this.listRecurrences()).map((r) => [r.id, r.startWeek]));
    const itemRows = raw.filter((r) => {
      const start = r.recurrence_id ? startWeeks.get(r.recurrence_id) : undefined;
      return !(start && Number(r.untouched) === 1 && weekIdOf(r.date) >= start);
    });
    // "뭐라도 기록한 주" = 업무 항목 또는 주간 메모에 글이 있는 주(data-spec 5-1, weekly-note-spec 6절)
    const weeksWithAnyRecord = new Set<WeekId>([
      ...itemRows.map((r) => weekIdOf(r.date)),
      ...(await this.noteWeeks(from, to)),
    ]);
    const weeksWithItemsByCategory = new Map<string, Set<WeekId>>();
    for (const r of itemRows) {
      const set = weeksWithItemsByCategory.get(r.category_id) ?? new Set<WeekId>();
      set.add(weekIdOf(r.date));
      weeksWithItemsByCategory.set(r.category_id, set);
    }
    const { categories, periods } = await this.listCategories();
    const leaveDates = new Set(
      Object.entries(await this.getDayMarks(from, to))
        .filter(([, k]) => isOffDay(k))
        .map(([d]) => d),
    );
    const leaveWeeks = new Set(
      [...new Set([...leaveDates].map(weekIdOf))].filter((w) => isLeaveWeek(w, leaveDates)),
    );
    return nudgeCandidates({
      currentWeek,
      nudgeWeeks: settings.nudgeWeeks,
      categories,
      periodsByCategory: groupPeriods(periods),
      weeksWithAnyRecord,
      leaveWeeks,
      weeksWithItemsByCategory,
    });
  }

  /** 종료 제안에 '유지': 이번 주 월요일 + N주 동안 다시 제안하지 않는다. */
  async snoozeNudge(categoryId: string, currentWeek: WeekId = this.currentWeek()): Promise<void> {
    const { nudgeWeeks } = await this.getSettings();
    await this.db.execute("UPDATE category SET nudge_snoozed_until = ?, updated_at = ? WHERE id = ?", [
      snoozeUntil(currentWeek, Math.max(nudgeWeeks, 1)),
      this.ts(),
      categoryId,
    ]);
  }

  // ── 연간 보기(미니맵) ───────────────────────────────
  /** ISO 연도의 주별 "기록한 날 수"(업무 항목 또는 메모가 있는 날) */
  async getYearDensity(isoYear: number): Promise<Map<WeekId, number>> {
    const first = `${isoYear}-W01`;
    const from = weekStart(first);
    const to = weekRange(addWeeks(first, weeksInIsoYear(isoYear) - 1)).end;
    const rows = await this.db.select<{ date: string }>(
      "SELECT DISTINCT date FROM entry_item WHERE date BETWEEN ? AND ?",
      [from, to],
    );
    const out = new Map<WeekId, number>();
    for (const r of rows) {
      const w = weekIdOf(r.date);
      out.set(w, (out.get(w) ?? 0) + 1);
    }
    // 메모에는 날짜가 없다: 업무 기록 없이 메모만 있는 주는 가장 연한 1단계(weekly-note-spec 11절 #8)
    for (const w of await this.noteWeeks(from, to)) if (!out.has(w)) out.set(w, 1);
    return out;
  }

  // ── 인사이트(m3-s1-spec 11-1) — 읽기 전용 ─────────────
  /** 한 업무의 기록(날짜 → 칸 안 순서). 경과 타임라인 본문 */
  async getCategoryEntries(categoryId: string, from: DateStr, to: DateStr): Promise<EntryItem[]> {
    const rows = await this.db.select<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM entry_item
       WHERE category_id = ? AND date BETWEEN ? AND ? ORDER BY date, seq`,
      [categoryId, from, to],
    );
    return rows.map(toItem);
  }

  /** 업무별 처음·마지막 기록일(전체)과 기간 안 항목 수 — 업무 목록·기간 밖 안내 */
  async getCategoryStats(
    from: DateStr,
    to: DateStr,
  ): Promise<{ categoryId: string; first: DateStr; last: DateStr; inRange: number }[]> {
    const rows = await this.db.select<{ category_id: string; first: string; last: string; n: number }>(
      `SELECT category_id, MIN(date) AS first, MAX(date) AS last,
              SUM(CASE WHEN date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS n
       FROM entry_item WHERE trim(text) <> '' GROUP BY category_id`,
      [from, to],
    );
    return rows.map((r) => ({
      categoryId: r.category_id,
      first: r.first,
      last: r.last,
      inRange: Number(r.n),
    }));
  }

  /** 한 업무의 날짜별 항목 수(전체 수명) — 업무 경과 지도(m3-s1-spec 4-0) */
  async getCategoryDays(categoryId: string): Promise<{ date: DateStr; items: number }[]> {
    const rows = await this.db.select<{ date: string; n: number }>(
      "SELECT date, COUNT(*) AS n FROM entry_item WHERE category_id = ? AND trim(text) <> '' GROUP BY date ORDER BY date",
      [categoryId],
    );
    return rows.map((r) => ({ date: r.date, items: Number(r.n) }));
  }

  /** 날짜 범위의 업무·날짜별 본/세부 항목 수와 첫 본 항목 글 — 활동 히트맵(m3-s2-spec 10-1) */
  async getActivity(from: DateStr, to: DateStr): Promise<ActivityRow[]> {
    const rows = await this.db.select<{
      category_id: string;
      date: string;
      mains: number;
      subs: number;
      first_text: string | null;
    }>(
      `SELECT e.category_id, e.date,
              SUM(CASE WHEN e.depth = 0 THEN 1 ELSE 0 END) AS mains,
              SUM(CASE WHEN e.depth = 1 THEN 1 ELSE 0 END) AS subs,
              (SELECT f.text FROM entry_item f
                WHERE f.category_id = e.category_id AND f.date = e.date AND f.depth = 0 AND trim(f.text) <> ''
                ORDER BY f.seq LIMIT 1) AS first_text
       FROM entry_item e
       WHERE e.date BETWEEN ? AND ? AND trim(e.text) <> ''
       GROUP BY e.category_id, e.date ORDER BY e.date`,
      [from, to],
    );
    return rows.map((r) => ({
      categoryId: r.category_id,
      date: r.date,
      mains: Number(r.mains),
      subs: Number(r.subs),
      firstText: r.first_text ?? null,
    }));
  }

  /** 주 범위의 저장된 메모 문서 — 업무연계 메모(ref.item)를 타임라인에 붙일 때. 예전 요일 메모는 연결이 없어 읽지 않는다 */
  /**
   * 검색(features-1102-spec F1): 업무 기록(본 항목·세부)과 메모 보드(글 상자·이미지 설명·링크 카드·관계선 이름표).
   * 낱말 AND·부분 일치, `from`(날짜)부터. 결과는 최근 주 먼저, 최대 SEARCH_LIMIT건(넘으면 truncated)
   */
  async search(query: string, from?: DateStr): Promise<{ hits: SearchHit[]; truncated: boolean }> {
    const terms = searchTerms(query);
    if (!terms.length) return { hits: [], truncated: false };
    const esc = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const where = terms.map(() => "lower(i.text) LIKE ? ESCAPE '\\'").join(" AND ");
    const params: SqlParam[] = terms.map(esc);
    if (from) params.push(from);
    const rows = await this.db.select<{
      id: string;
      date: string;
      category_id: string;
      depth: number;
      text: string;
      name: string;
      due_date: string | null;
    }>(
      `SELECT i.id, i.date, i.category_id, i.depth, i.text, i.due_date, c.name FROM entry_item i JOIN category c ON c.id = i.category_id
       WHERE ${where}${from ? " AND i.date >= ?" : ""} ORDER BY i.date DESC, c.sort_order, i.seq LIMIT ${SEARCH_LIMIT + 1}`,
      params,
    );
    const itemHits: SearchHit[] = rows.map((r) => ({
      key: `i:${r.id}`,
      area: "item",
      kind: Number(r.depth) > 0 ? "subitem" : "item",
      weekId: weekIdOf(r.date as DateStr),
      date: r.date as DateStr,
      categoryId: r.category_id,
      categoryName: r.name,
      itemId: r.id,
      text: r.text,
      dueDate: r.due_date,
    }));
    const notes = await this.db.select<{ week_id: string; doc: string }>(
      `SELECT week_id, doc FROM week_note${from ? " WHERE week_id >= ?" : ""}`,
      from ? [weekIdOf(from)] : [],
    );
    const memoHits = notes.flatMap((n) => searchNote(n.week_id as WeekId, parseNoteDoc(n.doc), terms));
    const all = sortHits([...itemHits, ...memoHits]);
    return { hits: all.slice(0, SEARCH_LIMIT), truncated: all.length > SEARCH_LIMIT };
  }

  /** 지식 카드 검색(UV3): 제목·요약·적용 조건·본문에 낱말이 모두 든 것(최근 고친 순, 50개까지) */
  async searchCards(query: string): Promise<CardHit[]> {
    const terms = searchTerms(query);
    if (!terms.length) return [];
    return (await this.listCards())
      .filter((c) => matchesAll(`${c.title} ${c.summary} ${c.conditions} ${c.body}`, terms))
      .slice(0, 50)
      .map((c) => ({
        id: c.id,
        type: c.type,
        status: c.status,
        title: c.title,
        text: [c.summary, c.conditions, c.body].find((x) => matchesAll(x, terms)) ?? c.summary ?? c.title,
      }));
  }

  /** Cabinet 검색(features-1102-spec F5 #7): 제목·주소/경로에 낱말이 모두 든 것 */
  async searchCabinet(query: string): Promise<CabinetHit[]> {
    const terms = searchTerms(query);
    if (!terms.length) return [];
    const { items } = await this.listCabinet();
    return items
      .filter((it) => matchesAll(`${it.title} ${it.target}`, terms))
      .map((it) => ({
        id: it.id,
        kind: it.kind,
        title: it.title,
        target: it.target,
        text: snippet(matchesAll(it.title, terms) ? it.title : it.target, terms),
      }));
  }

  // ── Cabinet(features-1102-spec F5) ────────────────────
  /** 등록한 폴더·링크와 연결(항목 연결은 그 항목의 날짜·글·업무 포함) */
  async listCabinet(): Promise<{ items: CabinetItem[]; links: CabinetLink[] }> {
    const items = await this.db.select<{
      id: string;
      kind: string;
      title: string;
      target: string;
      sort_order: number;
    }>("SELECT id, kind, title, target, sort_order FROM cabinet_item ORDER BY sort_order, created_at");
    const links = await this.db.select<{
      id: string;
      item_id: string;
      category_id: string | null;
      entry_id: string | null;
      e_date: string | null;
      e_text: string | null;
      e_cat: string | null;
    }>(
      `SELECT l.id, l.item_id, l.category_id, l.entry_id, e.date AS e_date, e.text AS e_text, e.category_id AS e_cat
       FROM cabinet_link l LEFT JOIN entry_item e ON e.id = l.entry_id ORDER BY l.created_at, l.id`,
    );
    return {
      items: items.map((r) => ({
        id: r.id,
        kind: r.kind as CabinetKind,
        title: r.title,
        target: r.target,
        sortOrder: Number(r.sort_order),
      })),
      links: links.map((r) => ({
        id: r.id,
        itemId: r.item_id,
        categoryId: r.category_id,
        entryId: r.entry_id,
        entry:
          r.entry_id && r.e_date ? { date: r.e_date, text: r.e_text ?? "", categoryId: r.e_cat ?? "" } : null,
      })),
    };
  }

  /** 대상 검사·정리: 폴더 = 절대 경로(`..` 없음), 링크 = http/https */
  private cabinetTarget(kind: CabinetKind, raw: string): string {
    const t = kind === "folder" ? normalizeFolderPath(raw) : raw.trim();
    if (t.length > CABINET_TARGET_MAX) throw new ValidationError("경로·주소가 너무 깁니다");
    if (kind === "folder" ? !isFolderPathLike(t) : !isOpenableUrl(t))
      throw new ValidationError(
        kind === "folder" ? "폴더 경로가 아닙니다" : "http·https 주소만 등록할 수 있습니다",
      );
    return t;
  }

  private cabinetLinkStatements(itemId: string, links: CabinetLinkDraft[], ts: string): SqlStatement[] {
    const seen = new Set<string>();
    return links.flatMap((l) => {
      const key = "categoryId" in l ? `c:${l.categoryId}` : `e:${l.entryId}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          sql: "INSERT INTO cabinet_link (id, item_id, category_id, entry_id, created_at) VALUES (?, ?, ?, ?, ?)",
          params: [
            uuidv7(),
            itemId,
            "categoryId" in l ? l.categoryId : null,
            "entryId" in l ? l.entryId : null,
            ts,
          ],
        },
      ];
    });
  }

  /**
   * 폴더·링크 등록(여러 개 한 번에). 같은 종류·같은 대상(폴더는 대소문자 무시)이 이미 있으면 새로 만들지 않고
   * 연결만 더한다. 돌려주는 값 = 등록(또는 이미 있던) 항목 id와 새로 만들었는지.
   */
  async addCabinetItems(
    drafts: { kind: CabinetKind; title: string; target: string; links?: CabinetLinkDraft[] }[],
  ): Promise<{ id: string; created: boolean }[]> {
    const { items, links } = await this.listCabinet();
    const ts = this.ts();
    let order = Math.max(0, ...items.map((i) => i.sortOrder));
    const same = (a: string, b: string, kind: CabinetKind) =>
      kind === "folder" ? a.toLowerCase() === b.toLowerCase() : a === b;
    const out: { id: string; created: boolean }[] = [];
    const stmts: SqlStatement[] = [];
    const made: CabinetItem[] = [];
    for (const d of drafts) {
      const target = this.cabinetTarget(d.kind, d.target);
      const title = normalizeCabinetTitle(d.title);
      if (!title) throw new ValidationError("제목을 적어 주세요");
      const existing = [...items, ...made].find((i) => i.kind === d.kind && same(i.target, target, d.kind));
      if (existing) {
        const have = links.filter((l) => l.itemId === existing.id);
        const extra = (d.links ?? []).filter((l) =>
          "categoryId" in l
            ? !have.some((h) => h.categoryId === l.categoryId)
            : !have.some((h) => h.entryId === l.entryId),
        );
        stmts.push(...this.cabinetLinkStatements(existing.id, extra, ts));
        out.push({ id: existing.id, created: false });
        continue;
      }
      const id = uuidv7(this.clock().getTime());
      order += 1;
      made.push({ id, kind: d.kind, title, target, sortOrder: order });
      stmts.push({
        sql: "INSERT INTO cabinet_item (id, kind, title, target, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params: [id, d.kind, title, target, order, ts, ts],
      });
      stmts.push(...this.cabinetLinkStatements(id, d.links ?? [], ts));
      out.push({ id, created: true });
    }
    if (stmts.length) await this.db.batch(stmts);
    return out;
  }

  /** 제목·대상 고치기(F2 제목 고치기) */
  async updateCabinetItem(id: string, patch: { title?: string; target?: string }): Promise<void> {
    const [row] = await this.db.select<{ kind: string }>("SELECT kind FROM cabinet_item WHERE id = ?", [id]);
    if (!row) return;
    const sets: string[] = [];
    const params: SqlParam[] = [];
    if (patch.title !== undefined) {
      const t = normalizeCabinetTitle(patch.title);
      if (!t) throw new ValidationError("제목을 적어 주세요");
      sets.push("title = ?");
      params.push(t);
    }
    if (patch.target !== undefined) {
      sets.push("target = ?");
      params.push(this.cabinetTarget(row.kind as CabinetKind, patch.target));
    }
    if (!sets.length) return;
    await this.db.execute(`UPDATE cabinet_item SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, [
      ...params,
      this.ts(),
      id,
    ]);
  }

  /** 연결 바꾸기(이 항목의 연결 전부를 주어진 것으로) */
  async setCabinetLinks(itemId: string, links: CabinetLinkDraft[]): Promise<void> {
    await this.db.batch([
      { sql: "DELETE FROM cabinet_link WHERE item_id = ?", params: [itemId] },
      ...this.cabinetLinkStatements(itemId, links, this.ts()),
    ]);
  }

  /** 순서 바꾸기 */
  async reorderCabinet(idsInOrder: string[]): Promise<void> {
    const ts = this.ts();
    await this.db.batch(
      idsInOrder.map((id, i) => ({
        sql: "UPDATE cabinet_item SET sort_order = ?, updated_at = ? WHERE id = ?",
        params: [i + 1, ts, id],
      })),
    );
  }

  /** 등록 해제 — 일지 안의 줄만 지운다(사용자 폴더·파일은 건드리지 않음). 되돌리기 자료를 돌려준다 */
  async removeCabinetItem(id: string): Promise<CabinetUndo | null> {
    const { items, links } = await this.listCabinet();
    const item = items.find((i) => i.id === id);
    if (!item) return null;
    const mine = links.filter((l) => l.itemId === id);
    await this.db.execute("DELETE FROM cabinet_item WHERE id = ?", [id]);
    return { item, links: mine };
  }

  async restoreCabinetItem(undo: CabinetUndo): Promise<void> {
    const ts = this.ts();
    const { item } = undo;
    await this.db.batch([
      {
        sql: "INSERT INTO cabinet_item (id, kind, title, target, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params: [item.id, item.kind, item.title, item.target, item.sortOrder, ts, ts],
      },
      ...undo.links.map((l) => ({
        // 그사이 지워진 업무·항목은 건너뛴다
        sql: `INSERT INTO cabinet_link (id, item_id, category_id, entry_id, created_at)
              SELECT ?, ?, ?, ?, ? WHERE (? IS NULL OR EXISTS (SELECT 1 FROM category WHERE id = ?))
                AND (? IS NULL OR EXISTS (SELECT 1 FROM entry_item WHERE id = ?))`,
        params: [
          l.id,
          item.id,
          l.categoryId,
          l.entryId,
          ts,
          l.categoryId,
          l.categoryId,
          l.entryId,
          l.entryId,
        ],
      })),
    ]);
  }

  /**
   * Universe(universe-spec 8-2): 이 일지의 업무·태그·항목·메모 상자·Cabinet을 한 번에 읽는다 — 읽기만(쓰지 않음).
   * 메모 그림 데이터는 읽지 않고(문서 JSON의 설명만), 예전 요일 메모만 있는 주는 고정 id로 읽기 전용 표현.
   */
  // ── Universe 직접 연결(UV2, universe-spec 5-1·8-1) ─────────────────────────
  /** 끊지 않은 직접 연결 전체 */
  async listRelations(): Promise<URelation[]> {
    const rows = await this.db.select<RelationRow>(
      "SELECT id, from_kind, from_id, from_week, to_kind, to_id, to_week, relation_type, note FROM universe_relation WHERE deleted_at IS NULL ORDER BY created_at, id",
    );
    return rows.map(relationOf);
  }

  /** 끝점이 이 일지에 지금 있는가(메모 상자는 그 주 문서 안에) */
  private async relationEndExists(e: URelationEnd): Promise<boolean> {
    const one = async (sql: string, p: SqlParam[]) => (await this.db.select(sql, p)).length > 0;
    switch (e.kind) {
      case "category":
        return one("SELECT 1 FROM category WHERE id = ?", [e.id]);
      case "tag":
        return one("SELECT 1 FROM tag WHERE id = ?", [e.id]);
      case "entry":
        return one("SELECT 1 FROM entry_item WHERE id = ?", [e.id]);
      case "cabinet":
        return one("SELECT 1 FROM cabinet_item WHERE id = ?", [e.id]);
      case "note": {
        if (!e.week) return false;
        const [row] = await this.db.select<{ doc: string }>("SELECT doc FROM week_note WHERE week_id = ?", [
          e.week,
        ]);
        return !!row && parseNoteDoc(row.doc).boxes.some((b) => b.id === e.id);
      }
      default:
        return false;
    }
  }

  /** 직접 연결 만들기 — 자기 연결·같은 끝·종류·방향 중복 금지, 두 끝이 이 일지에 있어야 한다 */
  async addRelation(d: Omit<URelation, "id">): Promise<URelation> {
    const note = d.note.trim();
    const draft = { ...d, note };
    const problem = relationProblem(await this.listRelations(), draft);
    if (problem) throw new RelationError(problem);
    if (!(await this.relationEndExists(d.from)) || !(await this.relationEndExists(d.to)))
      throw new RelationError("missing");
    const id = uuidv7(this.clock().getTime());
    const ts = this.ts();
    await this.db.batch([
      {
        sql: `INSERT INTO universe_relation (id, from_kind, from_id, from_week, to_kind, to_id, to_week, relation_type, note, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id,
          d.from.kind,
          d.from.id,
          d.from.week ?? null,
          d.to.kind,
          d.to.id,
          d.to.week ?? null,
          d.type,
          note,
          ts,
          ts,
        ],
      },
    ]);
    return { id, ...draft };
  }

  /** 종류·설명·방향(끝 바꾸기) 고치기 — 고치기 전 값을 돌려준다(실행 취소) */
  async updateRelation(
    id: string,
    patch: { type?: URelationType; note?: string; swap?: boolean },
  ): Promise<URelation> {
    const all = await this.listRelations();
    const before = all.find((r) => r.id === id);
    if (!before) throw new RelationError("missing");
    const next: URelation = {
      ...before,
      ...(patch.type ? { type: patch.type } : {}),
      ...(patch.note !== undefined ? { note: patch.note.trim() } : {}),
      ...(patch.swap ? { from: before.to, to: before.from } : {}),
    };
    const problem = relationProblem(all, next, id);
    if (problem) throw new RelationError(problem);
    await this.db.batch([
      {
        sql: `UPDATE universe_relation SET from_kind = ?, from_id = ?, from_week = ?, to_kind = ?, to_id = ?, to_week = ?,
                relation_type = ?, note = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND deleted_at IS NULL`,
        params: [
          next.from.kind,
          next.from.id,
          next.from.week ?? null,
          next.to.kind,
          next.to.id,
          next.to.week ?? null,
          next.type,
          next.note,
          this.ts(),
          id,
        ],
      },
    ]);
    return before;
  }

  /** 끊기(소프트 삭제 — 되돌리기 가능, 원문은 그대로) */
  async deleteRelation(id: string): Promise<void> {
    await this.db.batch([
      {
        sql: "UPDATE universe_relation SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND deleted_at IS NULL",
        params: [this.ts(), this.ts(), id],
      },
    ]);
  }

  /** 끊은 연결 되살리기(실행 취소) — 그사이 같은 연결을 다시 만들었으면 중복이라 되살리지 않는다 */
  async restoreRelation(id: string): Promise<boolean> {
    const [row] = await this.db.select<RelationRow & { deleted_at: string | null }>(
      "SELECT id, from_kind, from_id, from_week, to_kind, to_id, to_week, relation_type, note, deleted_at FROM universe_relation WHERE id = ?",
      [id],
    );
    if (!row || !row.deleted_at) return false;
    const r = relationOf(row);
    if (relationProblem(await this.listRelations(), r, id)) return false;
    await this.db.batch([
      {
        sql: "UPDATE universe_relation SET deleted_at = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?",
        params: [this.ts(), id],
      },
    ]);
    return true;
  }

  // ── 지식 카드(UV3, universe-spec 5-2·8-1) ─────────────────────────────────
  /** 지금 원문(지문 재료) — 끝점마다. 없으면 그 키가 빠진다 */
  async sourcesNow(
    list: { kind: CardSourceKind; sourceId: string; week?: WeekId | null }[],
  ): Promise<Map<string, SourceNow>> {
    const out = new Map<string, SourceNow>();
    const ids = (k: CardSourceKind) => [...new Set(list.filter((x) => x.kind === k).map((x) => x.sourceId))];
    const marks = (n: number) => Array(n).fill("?").join(", ");
    const { categories } = await this.readCategories();
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const entryIds = ids("entry");
    if (entryIds.length) {
      const rows = await this.db.select<{
        id: string;
        date: string;
        category_id: string;
        depth: number;
        seq: number;
        text: string;
      }>(
        `SELECT e.id, e.date, e.category_id, e.depth, e.seq, e.text FROM entry_item e
          WHERE EXISTS (SELECT 1 FROM entry_item x WHERE x.id IN (${marks(entryIds.length)}) AND x.date = e.date AND x.category_id = e.category_id)
          ORDER BY e.date, e.category_id, e.seq`,
        entryIds,
      );
      let parent = "";
      let cell = "";
      const want = new Set(entryIds);
      for (const r of rows) {
        const k = `${r.date}|${r.category_id}`;
        if (k !== cell) {
          cell = k;
          parent = "";
        }
        const depth = Number(r.depth) > 0 ? 1 : 0;
        if (want.has(r.id))
          out.set(sourceKey({ kind: "entry", sourceId: r.id }), {
            text: r.text,
            content: `${depth}|${r.text}|${depth ? parent : ""}`,
            location: `${r.date}|${r.category_id}`,
            locator: `${catName.get(r.category_id) ?? ""} · ${r.date}`,
          });
        if (!depth) parent = r.text;
      }
    }
    const weeks = [...new Set(list.filter((x) => x.kind === "note" && x.week).map((x) => x.week!))];
    if (weeks.length) {
      const rows = await this.db.select<{ week_id: string; doc: string }>(
        `SELECT week_id, doc FROM week_note WHERE week_id IN (${marks(weeks.length)})`,
        weeks,
      );
      for (const r of rows)
        for (const b of (await this.hydrateNote(r.week_id, parseNoteDoc(r.doc))).boxes) {
          const key = sourceKey({ kind: "note", sourceId: b.id, week: r.week_id as WeekId });
          if (!list.some((x) => sourceKey(x) === key)) continue;
          const text = boxText(b).trim() || boxName(b);
          const refs = (b.refs ?? []).map((x) => x.item).join(",");
          out.set(key, {
            text,
            content: `${b.kind}|${text}|${b.kind === "link" ? `${b.url}|${b.note}` : ""}|${refs}`,
            location: r.week_id,
            locator: `${STR_NOTE_WEEK} ${r.week_id}`,
          });
        }
    }
    const cabIds = ids("cabinet");
    if (cabIds.length) {
      const rows = await this.db.select<{ id: string; title: string; target: string }>(
        `SELECT id, title, target FROM cabinet_item WHERE id IN (${marks(cabIds.length)})`,
        cabIds,
      );
      for (const r of rows)
        out.set(sourceKey({ kind: "cabinet", sourceId: r.id }), {
          text: r.title,
          content: `${r.title}|${r.target}`,
          location: "",
          locator: "Cabinet",
        });
    }
    for (const c of categories)
      if (ids("category").includes(c.id))
        out.set(sourceKey({ kind: "category", sourceId: c.id }), {
          text: c.name,
          content: c.name,
          location: "",
          locator: "업무",
        });
    const tagIds = ids("tag");
    if (tagIds.length) {
      const { tags } = await this.readTags();
      for (const t of tags)
        if (tagIds.includes(t.id))
          out.set(sourceKey({ kind: "tag", sourceId: t.id }), {
            text: `# ${t.name}`,
            content: t.name,
            location: "",
            locator: "태그",
          });
    }
    return out;
  }

  /** 지우지 않은 카드 전체(관련 업무·출처 포함, 출처는 순서대로) */
  async listCards(): Promise<KnowledgeCard[]> {
    const cards = await this.db.select<CardRow>(
      "SELECT id, card_type, title, summary, conditions, body, status, revision, created_at, updated_at, reviewed_at FROM knowledge_card WHERE deleted_at IS NULL ORDER BY updated_at DESC, id",
    );
    if (!cards.length) return [];
    const cats = await this.db.select<{ card_id: string; category_id: string }>(
      "SELECT card_id, category_id FROM knowledge_card_category",
    );
    const srcs = await this.db.select<CardSourceRow & { sort_order: number }>(
      "SELECT id, card_id, source_kind, source_id, source_week, excerpt, content_fp, location_fp, locator_json, captured_at, sort_order FROM knowledge_card_source ORDER BY card_id, sort_order",
    );
    return cards.map((c) => ({
      id: c.id,
      type: c.card_type as CardType,
      title: c.title,
      summary: c.summary,
      conditions: c.conditions,
      body: c.body,
      status: c.status as CardStatus,
      revision: Number(c.revision),
      categoryIds: cats.filter((x) => x.card_id === c.id).map((x) => x.category_id),
      sources: srcs
        .filter((x) => x.card_id === c.id)
        .map((x): CardSource => ({
          id: x.id,
          kind: x.source_kind as CardSourceKind,
          sourceId: x.source_id,
          ...(x.source_week ? { week: x.source_week as WeekId } : {}),
          excerpt: x.excerpt,
          contentFp: x.content_fp,
          locationFp: x.location_fp,
          locator: locatorOf(x.locator_json),
          capturedAt: x.captured_at,
        })),
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      reviewedAt: c.reviewed_at,
    }));
  }

  async getCard(id: string): Promise<KnowledgeCard | null> {
    return (await this.listCards()).find((c) => c.id === id) ?? null;
  }

  /** 초안 정리 + 검사 — 앞뒤 빈칸·같은 출처 중복 제거, 관련 업무는 있는 것만 */
  private async cleanCard(d: CardDraft): Promise<CardDraft> {
    const seen = new Set<string>();
    const sources = d.sources.filter((x) => {
      const k = sourceKey(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const { categories } = await this.readCategories();
    const have = new Set(categories.map((c) => c.id));
    const out: CardDraft = {
      ...d,
      title: d.title.trim(),
      summary: d.summary.trim(),
      conditions: d.conditions.trim(),
      body: d.body.replace(/\s+$/, ""),
      categoryIds: [...new Set(d.categoryIds)].filter((c) => have.has(c)),
      sources,
    };
    const problem = cardProblem(out);
    if (problem) throw new CardError(problem);
    return out;
  }

  private sourceInsert(
    cardId: string,
    s: CardDraft["sources"][number],
    now: SourceNow,
    order: number,
    ts: string,
  ) {
    return {
      sql: `INSERT INTO knowledge_card_source (id, card_id, source_kind, source_id, source_week, excerpt, content_fp, location_fp, locator_json, sort_order, captured_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        uuidv7(this.clock().getTime()),
        cardId,
        s.kind,
        s.sourceId,
        s.week ?? null,
        clip(now.text, CARD_LIMITS.excerpt),
        fingerprint(now.content),
        fingerprint(now.location),
        JSON.stringify({ label: now.locator }),
        order,
        ts,
      ] as SqlParam[],
    };
  }

  /** 카드 만들기 — 출처는 지금 원문을 "당시 발췌"로 남긴다(원문이 없으면 거부) */
  async createCard(draft: CardDraft): Promise<KnowledgeCard> {
    const d = await this.cleanCard(draft);
    const now = await this.sourcesNow(d.sources);
    if (d.sources.some((x) => !now.has(sourceKey(x)))) throw new CardError("missing");
    const id = uuidv7(this.clock().getTime());
    const ts = this.ts();
    await this.db.batch([
      {
        sql: `INSERT INTO knowledge_card (id, card_type, title, summary, conditions, body, status, created_at, updated_at, reviewed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id,
          d.type,
          d.title,
          d.summary,
          d.conditions,
          d.body,
          d.status,
          ts,
          ts,
          d.status === "reviewed" ? ts : null,
        ],
      },
      ...d.categoryIds.map((c) => ({
        sql: "INSERT INTO knowledge_card_category (card_id, category_id) VALUES (?, ?)",
        params: [id, c] as SqlParam[],
      })),
      ...d.sources.map((x, i) => this.sourceInsert(id, x, now.get(sourceKey(x))!, i, ts)),
    ]);
    return (await this.getCard(id))!;
  }

  /**
   * 카드 고치기 — 남은 출처는 당시 발췌·지문을 그대로 두고, 새 출처만 지금 원문으로 남긴다.
   * revision이 다르면(다른 곳에서 먼저 고침) 거부. 고치기 전 카드를 돌려준다(실행 취소)
   */
  async updateCard(id: string, draft: CardDraft, revision?: number): Promise<KnowledgeCard> {
    const before = await this.getCard(id);
    if (!before) throw new CardError("missing");
    if (revision !== undefined && revision !== before.revision) throw new CardError("stale");
    const d = await this.cleanCard(draft);
    const kept = new Map(before.sources.map((x) => [sourceKey(x), x]));
    const fresh = d.sources.filter((x) => !kept.has(sourceKey(x)));
    const now = await this.sourcesNow(fresh);
    if (fresh.some((x) => !now.has(sourceKey(x)))) throw new CardError("missing");
    const ts = this.ts();
    const stmts: SqlStatement[] = [
      {
        sql: `UPDATE knowledge_card SET card_type = ?, title = ?, summary = ?, conditions = ?, body = ?, status = ?, updated_at = ?,
                reviewed_at = CASE WHEN ? = 'reviewed' AND status <> 'reviewed' THEN ? WHEN ? = 'draft' THEN NULL ELSE reviewed_at END,
                revision = revision + 1 WHERE id = ? AND deleted_at IS NULL`,
        params: [d.type, d.title, d.summary, d.conditions, d.body, d.status, ts, d.status, ts, d.status, id],
      },
      { sql: "DELETE FROM knowledge_card_category WHERE card_id = ?", params: [id] },
      ...d.categoryIds.map((c) => ({
        sql: "INSERT INTO knowledge_card_category (card_id, category_id) VALUES (?, ?)",
        params: [id, c] as SqlParam[],
      })),
    ];
    const keepKeys = new Set(d.sources.map(sourceKey));
    for (const x of before.sources)
      if (!keepKeys.has(sourceKey(x)))
        stmts.push({ sql: "DELETE FROM knowledge_card_source WHERE id = ?", params: [x.id] });
    d.sources.forEach((x, i) => {
      const k = kept.get(sourceKey(x));
      if (k)
        stmts.push({
          sql: "UPDATE knowledge_card_source SET sort_order = ? WHERE id = ?",
          params: [i, k.id],
        });
      else stmts.push(this.sourceInsert(id, x, now.get(sourceKey(x))!, i, ts));
    });
    await this.db.batch(stmts);
    return before;
  }

  /** 상태만 바꾸기(초안 → 검토함 → 보관) — "검토함"은 사용자가 적용 조건·출처를 확인했다는 표시 */
  async setCardStatus(id: string, status: CardStatus): Promise<CardStatus> {
    const before = await this.getCard(id);
    if (!before) throw new CardError("missing");
    const ts = this.ts();
    await this.db.batch([
      {
        sql: `UPDATE knowledge_card SET status = ?, updated_at = ?, revision = revision + 1,
                reviewed_at = CASE WHEN ? = 'reviewed' THEN ? WHEN ? = 'draft' THEN NULL ELSE reviewed_at END
              WHERE id = ? AND deleted_at IS NULL`,
        params: [status, ts, status, ts, status, id],
      },
    ]);
    return before.status;
  }

  /** 출처 [다시 확인] — 지금 원문을 새 발췌·지문으로(원문이 없으면 거부) */
  async recheckCardSource(cardId: string, sourceRowId: string): Promise<void> {
    const card = await this.getCard(cardId);
    const src = card?.sources.find((x) => x.id === sourceRowId);
    if (!card || !src) throw new CardError("missing");
    const now = (await this.sourcesNow([src])).get(sourceKey(src));
    if (!now) throw new CardError("missing");
    const ts = this.ts();
    await this.db.batch([
      {
        sql: "UPDATE knowledge_card_source SET excerpt = ?, content_fp = ?, location_fp = ?, locator_json = ?, captured_at = ? WHERE id = ?",
        params: [
          clip(now.text, CARD_LIMITS.excerpt),
          fingerprint(now.content),
          fingerprint(now.location),
          JSON.stringify({ label: now.locator }),
          ts,
          sourceRowId,
        ],
      },
      {
        sql: "UPDATE knowledge_card SET updated_at = ?, revision = revision + 1 WHERE id = ?",
        params: [ts, cardId],
      },
    ]);
  }

  /** 지우기(소프트 — 되돌리기 가능) */
  async deleteCard(id: string): Promise<void> {
    await this.db.batch([
      {
        sql: "UPDATE knowledge_card SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND deleted_at IS NULL",
        params: [this.ts(), this.ts(), id],
      },
    ]);
  }

  async restoreCard(id: string): Promise<void> {
    await this.db.batch([
      {
        sql: "UPDATE knowledge_card SET deleted_at = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?",
        params: [this.ts(), id],
      },
    ]);
  }

  /** 보드 ◆ 표시: 카드 출처인 항목 → 카드 id들 */
  async cardSourceEntries(): Promise<Record<string, string[]>> {
    const rows = await this.db.select<{ source_id: string; card_id: string }>(
      `SELECT s.source_id, s.card_id FROM knowledge_card_source s JOIN knowledge_card c ON c.id = s.card_id
        WHERE s.source_kind = 'entry' AND c.deleted_at IS NULL ORDER BY c.updated_at DESC`,
    );
    const out: Record<string, string[]> = {};
    for (const r of rows) (out[r.source_id] ??= []).push(r.card_id);
    return out;
  }

  /** 작성 중 임시본(창을 닫아도 복구) — 이 일지 안 app_meta에만 */
  async getCardDraft(): Promise<CardDraft | null> {
    const [row] = await this.db.select<{ value: string }>(
      "SELECT value FROM app_meta WHERE key = 'card_draft'",
    );
    if (!row) return null;
    try {
      const v = JSON.parse(row.value) as CardDraft;
      return v && typeof v.title === "string" && Array.isArray(v.sources) ? v : null;
    } catch {
      return null;
    }
  }

  async saveCardDraft(d: CardDraft | null): Promise<void> {
    if (!d) {
      await this.db.execute("DELETE FROM app_meta WHERE key = 'card_draft'");
      return;
    }
    await this.db.execute(
      "INSERT INTO app_meta (key, value) VALUES ('card_draft', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [JSON.stringify(d)],
    );
  }

  async getUniverseSnapshot(ws: UniverseSnapshot["ws"]): Promise<UniverseSnapshot> {
    const { categories, periods } = await this.readCategories();
    const open = new Set(periods.filter((p) => p.endDate === null).map((p) => p.categoryId));
    const { tags, byCategory } = await this.readTags();
    const entries = await this.db.select<{
      id: string;
      date: string;
      category_id: string;
      depth: number;
      seq: number;
      text: string;
      flagged: number;
      due_date: string | null;
    }>(
      "SELECT id, date, category_id, depth, seq, text, flagged, due_date FROM entry_item ORDER BY date, category_id, seq",
    );
    const noteRows = await this.db.select<{ week_id: string; doc: string }>(
      "SELECT week_id, doc FROM week_note",
    );
    const notes: UniverseSnapshot["notes"] = await Promise.all(
      noteRows.map(async (r) => ({
        weekId: r.week_id as WeekId,
        doc: await this.hydrateNote(r.week_id, parseNoteDoc(r.doc)),
      })),
    );
    const have = new Set(notes.map((n) => n.weekId));
    const memos = await this.db.select<{ date: string; text: string }>("SELECT date, text FROM day_memo");
    const legacy = new Map<WeekId, Record<DateStr, string>>();
    for (const m of memos) {
      const w = weekIdOf(m.date as DateStr);
      if (have.has(w)) continue;
      legacy.set(w, { ...(legacy.get(w) ?? {}), [m.date]: m.text });
    }
    for (const [w, byDay] of legacy) {
      let n = 0;
      const doc = docFromDayMemos(w, byDay, () => `legacy-${w}-${n++}`);
      if (doc.boxes.length) notes.push({ weekId: w, doc });
    }
    const cab = await this.listCabinet();
    return {
      ws,
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        ended: !open.has(c.id),
        tagIds: byCategory[c.id] ?? [],
      })),
      tags: tags.map((t) => ({ id: t.id, name: t.name })),
      entries: entries.map((e) => ({
        id: e.id,
        date: e.date as DateStr,
        categoryId: e.category_id,
        depth: (Number(e.depth) > 0 ? 1 : 0) as 0 | 1,
        seq: Number(e.seq),
        text: e.text,
        flagged: Number(e.flagged) === 1,
        dueDate: e.due_date,
      })),
      notes,
      cabinet: {
        items: cab.items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, target: i.target })),
        links: cab.links.map((l) => ({ itemId: l.itemId, categoryId: l.categoryId, entryId: l.entryId })),
      },
      relations: await this.listRelations(),
      cards: await this.listCards(),
    };
  }

  async getWeekNotesBetween(
    fromWeek: WeekId,
    toWeek: WeekId,
    includeLinked = false,
  ): Promise<Record<WeekId, NoteDoc>> {
    const rows = await this.db.select<{ week_id: string; doc: string }>(
      `SELECT week_id, doc FROM week_note WHERE week_id BETWEEN ? AND ?${includeLinked ? " OR week_id IN (SELECT l.note_week_id FROM note_entry_link l JOIN entry_item e ON e.id = l.entry_id WHERE e.date BETWEEN ? AND ?)" : ""}`,
      includeLinked ? [fromWeek, toWeek, weekStart(fromWeek), weekRange(toWeek).end] : [fromWeek, toWeek],
    );
    return Object.fromEntries(
      await Promise.all(
        rows.map(async (r) => [r.week_id, await this.hydrateNote(r.week_id, parseNoteDoc(r.doc))]),
      ),
    );
  }

  // ── 기존 일지 가져오기(i-m3-plan 3절) ─────────────────
  /** 가져오기 양식의 `업무` 시트에 미리 채울 업무: 이번 주 진행 중인 업무(보드 순서) */
  async importTemplateCategories(): Promise<string[]> {
    const view = await this.getWeek(this.currentWeek());
    return view.categories.filter((v) => v.state === "active").map((v) => v.category.name);
  }

  /** 계획 세우기에 필요한 이 앱 상태: 업무·구간 전부, 파일에 나온 주들의 항목·주간 메모 */
  async importContext(weekIds: WeekId[]): Promise<ImportContext> {
    const { categories, periods } = await this.listCategories();
    const items: ExistingItem[] = [];
    const notes: ImportContext["notes"] = {};
    for (const w of weekIds) {
      const { start, end } = weekRange(w);
      const rows = await this.db.select<{
        id: string;
        date: string;
        category_id: string;
        seq: number;
        depth: number;
        text: string;
      }>(
        "SELECT id, date, category_id, seq, depth, text FROM entry_item WHERE date BETWEEN ? AND ? ORDER BY date, seq",
        [start, end],
      );
      for (const r of rows)
        items.push({
          id: r.id,
          date: r.date,
          categoryId: r.category_id,
          seq: r.seq,
          depth: r.depth as 0 | 1,
          text: r.text,
        });
      const { doc } = await this.getWeekNote(w);
      notes[w] = { boxes: doc.boxes.length, empty: isNoteEmpty(doc) };
    }
    return {
      today: this.today(),
      categories: categories.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder })),
      periods,
      items,
      notes,
    };
  }

  /**
   * 계획대로 쓰기 — 한 batch(전부 성공 또는 전부 취소, CLAUDE.md 4-3). 가져오기 직전 자동 백업은 부르는 쪽(세션)이 먼저 한다.
   * 가져온 행에는 가져오기 id를 달고, 되돌리기에 필요한 것(덮어쓰기로 지운 행·메모 문서·만든 업무·앞당긴 구간)을 함께 남긴다.
   */
  async applyImport(plan: ImportPlan, fileName: string): Promise<ImportResult> {
    const id = uuidv7(this.clock().getTime());
    const ts = this.ts();
    const stmts: SqlStatement[] = [];
    const undo: ImportUndo = {
      relations: await this.itemRelations(plan.deleteItemIds),
      deletedItems: [],
      notes: [],
      createdCategories: [],
      periodStarts: [],
      reopened: [],
    };

    // 새 업무(이번 주까지 이어지는 열린 구간)
    const [stat] = await this.db.select<{ n: number }>("SELECT COUNT(*) AS n FROM category");
    const newIds = new Map<string, string>();
    plan.newCategories.forEach((c, i) => {
      const cid = uuidv7(this.clock().getTime());
      newIds.set(c.key, cid);
      undo.createdCategories.push(cid);
      stmts.push(
        {
          sql: "INSERT INTO category (id, name, color, sort_order, nudge_snoozed_until, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
          params: [cid, c.name, nextColorKey(Number(stat?.n ?? 0) + i), c.sortOrder, ts, ts],
        },
        {
          sql: "INSERT INTO category_period (id, category_id, start_date, end_date) VALUES (?, ?, ?, NULL)",
          params: [uuidv7(), cid, c.startDate],
        },
      );
    });
    for (const m of plan.periodMoves) {
      undo.periodStarts.push({ periodId: m.periodId, start: m.from });
      stmts.push({
        sql: "UPDATE category_period SET start_date = ? WHERE id = ?",
        params: [m.to, m.periodId],
      });
    }
    for (const cid of plan.reopen) {
      const periods = await this.periodsOf(cid);
      if (openPeriod(periods)) continue;
      const rp = reactivatePlan(periods, weekStart(this.currentWeek()));
      if (rp.kind === "reopen") {
        const prev = periods.find((p) => p.id === rp.periodId)!;
        undo.reopened.push({ periodId: rp.periodId, end: prev.endDate });
        stmts.push({ sql: "UPDATE category_period SET end_date = NULL WHERE id = ?", params: [rp.periodId] });
      } else {
        const pid = uuidv7();
        undo.reopened.push({ periodId: pid, end: null, created: true });
        stmts.push({
          sql: "INSERT INTO category_period (id, category_id, start_date, end_date) VALUES (?, ?, ?, NULL)",
          params: [pid, cid, rp.startDate],
        });
      }
    }

    // 덮어쓰기: 그 주의 기존 항목을 지우기 전에 통째로 남긴다
    for (let i = 0; i < plan.deleteItemIds.length; i += 500) {
      const ids = plan.deleteItemIds.slice(i, i + 500);
      undo.deletedItems.push(
        ...(await this.db.select<ItemSnapshot>(
          `SELECT id, date, category_id, seq, depth, text, flagged, flag_done_at, completion_was_flagged, recurrence_id, start_time, due_date, created_at, updated_at, import_id
           FROM entry_item WHERE id IN (${ids.map(() => "?").join(", ")})`,
          ids,
        )),
      );
      stmts.push({
        sql: `DELETE FROM entry_item WHERE id IN (${ids.map(() => "?").join(", ")})`,
        params: ids,
      });
    }

    for (const it of plan.inserts) {
      const cid = "id" in it.cat ? it.cat.id : newIds.get(it.cat.newKey)!;
      stmts.push({
        sql: `INSERT INTO entry_item (id, date, category_id, seq, depth, text, created_at, updated_at, import_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [uuidv7(this.clock().getTime()), it.date, cid, it.seq, it.depth, it.text, ts, ts, id],
      });
    }

    // 주간 메모: 추가 = 상자 하나 더함, 바꿈 = 그 상자(없으면 빈 메모)로
    for (const m of plan.memos) {
      const [row] = await this.db.select<{ doc: string }>("SELECT doc FROM week_note WHERE week_id = ?", [
        m.weekId,
      ]);
      undo.notes.push({ weekId: m.weekId, doc: row?.doc ?? null });
      if (m.mode !== "add") {
        const relations = await this.noteLinks(m.weekId);
        undo.relations!.notes.push(
          ...relations.map((r) => ({ ...r, note_week_id: m.weekId, created_at: ts })),
        );
        stmts.push({ sql: "DELETE FROM note_entry_link WHERE note_week_id = ?", params: [m.weekId] });
      }
      const current = m.mode === "add" ? (await this.getWeekNote(m.weekId)).doc : emptyDoc();
      const boxes = m.lines.length
        ? [...current.boxes, importMemoBox(uuidv7(), m.lines, positionBelow(current), topZ(current) + 1)]
        : current.boxes;
      const storedDoc = JSON.stringify({
        v: 1,
        boxes: parseNoteDoc(JSON.stringify({ v: 1, boxes })).boxes.map((b) => {
          const { refs: _refs, ...box } = b;
          void _refs;
          return box;
        }),
      });
      stmts.push({
        sql: "INSERT INTO week_note (week_id, doc, updated_at) VALUES (?, ?, ?) ON CONFLICT(week_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at",
        params: [m.weekId, storedDoc, ts],
      });
    }

    // 가져오기 기록은 맨 앞에(항목의 import_id가 가리킴)
    stmts.unshift({
      sql: "INSERT INTO import_batch (id, file_name, week_count, item_count, undo_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      params: [id, fileName.slice(0, 200), plan.totals.weeks, plan.totals.items, JSON.stringify(undo), ts],
    });
    await this.db.batch(stmts);
    return {
      id,
      items: plan.totals.items,
      weeks: plan.totals.weeks,
      newCategories: plan.newCategories.length,
    };
  }

  async listImports(): Promise<ImportBatchInfo[]> {
    const rows = await this.db.select<{
      id: string;
      file_name: string;
      week_count: number;
      item_count: number;
      created_at: string;
      undone_at: string | null;
    }>(
      "SELECT id, file_name, week_count, item_count, created_at, undone_at FROM import_batch ORDER BY created_at DESC, rowid DESC",
    );
    return rows.map((r) => ({
      id: r.id,
      fileName: r.file_name,
      weeks: r.week_count,
      items: r.item_count,
      createdAt: r.created_at,
      undoneAt: r.undone_at,
    }));
  }

  /** 가져온 뒤 사용자가 고친 항목 수(되돌리기 확인 문구) */
  async countEditedImported(importId: string): Promise<number> {
    const [r] = await this.db.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM entry_item WHERE import_id = ? AND updated_at <> created_at",
      [importId],
    );
    return Number(r?.n ?? 0);
  }

  /**
   * 가져오기 되돌리기(3-9절 3): 가져온 행 삭제(keepEdited면 고친 행은 남김) + 덮어쓰기로 지운 행·메모 되살림
   * + 앞당긴 구간·다시 시작한 구간 원래대로 + 그 가져오기로 만든 업무는 남은 기록이 없으면 삭제. 한 batch.
   */
  async undoImport(importId: string, keepEdited: boolean): Promise<{ removed: number; restored: number }> {
    const [batch] = await this.db.select<{ undo_json: string; undone_at: string | null }>(
      "SELECT undo_json, undone_at FROM import_batch WHERE id = ?",
      [importId],
    );
    if (!batch || batch.undone_at) return { removed: 0, restored: 0 };
    const undo = JSON.parse(batch.undo_json) as ImportUndo;
    const [cnt] = await this.db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM entry_item WHERE import_id = ?${keepEdited ? " AND updated_at = created_at" : ""}`,
      [importId],
    );
    const stmts: SqlStatement[] = [
      {
        sql: `DELETE FROM entry_item WHERE import_id = ?${keepEdited ? " AND updated_at = created_at" : ""}`,
        params: [importId],
      },
      // 남긴(고친) 행은 손으로 쓴 기록처럼 — 되돌린 가져오기를 가리키지 않게
      { sql: "UPDATE entry_item SET import_id = NULL WHERE import_id = ?", params: [importId] },
    ];
    for (const it of undo.deletedItems)
      stmts.push({
        sql: `INSERT OR IGNORE INTO entry_item (id, date, category_id, seq, depth, text, flagged, flag_done_at, completion_was_flagged, recurrence_id,
                                                start_time, due_date, created_at, updated_at, import_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          it.id,
          it.date,
          it.category_id,
          it.seq,
          it.depth,
          it.text,
          it.flagged,
          it.flag_done_at,
          it.completion_was_flagged ?? 1,
          it.recurrence_id,
          it.start_time ?? null,
          it.due_date ?? null,
          it.created_at,
          it.updated_at,
          it.import_id,
        ],
      });
    for (const n of undo.notes)
      stmts.push(
        n.doc === null
          ? { sql: "DELETE FROM week_note WHERE week_id = ?", params: [n.weekId] }
          : {
              sql: "INSERT INTO week_note (week_id, doc, updated_at) VALUES (?, ?, ?) ON CONFLICT(week_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at",
              params: [n.weekId, n.doc, this.ts()],
            },
      );
    if (undo.relations) stmts.push(...this.relationStatements(undo.relations));
    for (const p of undo.periodStarts)
      stmts.push({
        sql: "UPDATE category_period SET start_date = ? WHERE id = ?",
        params: [p.start, p.periodId],
      });
    for (const p of undo.reopened)
      stmts.push(
        p.created
          ? { sql: "DELETE FROM category_period WHERE id = ?", params: [p.periodId] }
          : { sql: "UPDATE category_period SET end_date = ? WHERE id = ?", params: [p.end, p.periodId] },
      );
    // 만든 업무: 위 삭제 뒤에도 기록이 남지 않으면 함께 지운다(구간은 ON DELETE CASCADE)
    for (const cid of undo.createdCategories)
      stmts.push({
        sql: "DELETE FROM category WHERE id = ? AND NOT EXISTS (SELECT 1 FROM entry_item WHERE category_id = ?)",
        params: [cid, cid],
      });
    stmts.push({ sql: "UPDATE import_batch SET undone_at = ? WHERE id = ?", params: [this.ts(), importId] });
    await this.db.batch(stmts);
    return { removed: Number(cnt?.n ?? 0), restored: undo.deletedItems.length };
  }

  /** 되돌리기로 되살릴 수 있는 메모 문서가 가리키는 그 주 이미지(정리하지 않게) */
  private async undoAssetIds(weekId: WeekId): Promise<string[]> {
    const rows = await this.db.select<{ undo_json: string }>(
      "SELECT undo_json FROM import_batch WHERE undone_at IS NULL AND undo_json LIKE ?",
      [`%${weekId}%`],
    );
    return rows.flatMap((r) =>
      (JSON.parse(r.undo_json) as ImportUndo).notes
        .filter((n) => n.weekId === weekId && n.doc)
        .flatMap((n) => noteAssetIds(parseNoteDoc(n.doc))),
    );
  }
}
