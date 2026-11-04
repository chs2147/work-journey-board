// 지식 카드(universe-spec 5-2·8-1, UV3): 검증·지문·근거 상태 — 순수 함수만.
// 카드는 원문을 복사해 고치지 않는다: 출처마다 "당시 발췌" + 지문을 남기고, 원문이 바뀌면 배지로만 알린다.
import type { WeekId } from "./week";

export type CardType = "solution" | "decision" | "learning" | "guide";
export const CARD_TYPES: CardType[] = ["solution", "decision", "learning", "guide"];
export type CardStatus = "draft" | "reviewed" | "archived";
export const CARD_STATUSES: CardStatus[] = ["draft", "reviewed", "archived"];
export type CardSourceKind = "entry" | "note" | "cabinet" | "category" | "tag";
export const CARD_SOURCE_KINDS: CardSourceKind[] = ["entry", "note", "cabinet", "category", "tag"];

export const CARD_LIMITS = {
  title: 120,
  summary: 300,
  conditions: 1000,
  body: 10000,
  excerpt: 2000,
  minSources: 1,
  maxSources: 50,
} as const;

export interface CardSource {
  id: string;
  kind: CardSourceKind;
  sourceId: string;
  /** 메모 상자만 — 상자 id는 주 문서 안에서만 고유 */
  week?: WeekId | null;
  /** 당시 발췌(카드를 만들 때·[다시 확인] 때의 원문) */
  excerpt: string;
  contentFp: string;
  locationFp: string;
  /** 사람이 읽는 위치(예: "정산 · 10/22") — 원문이 없어져도 어디였는지 */
  locator: string;
  capturedAt: string;
}

export interface KnowledgeCard {
  id: string;
  type: CardType;
  title: string;
  summary: string;
  conditions: string;
  body: string;
  status: CardStatus;
  revision: number;
  categoryIds: string[];
  sources: CardSource[];
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
}

/** 카드 초안(편집기·임시 보관) — 출처는 아직 지문 없이 끝점만 */
export interface CardDraft {
  id?: string;
  type: CardType;
  title: string;
  summary: string;
  conditions: string;
  body: string;
  status: CardStatus;
  categoryIds: string[];
  sources: { kind: CardSourceKind; sourceId: string; week?: WeekId | null }[];
}

export type CardProblem =
  "title" | "summary" | "conditions" | "body" | "type" | "status" | "sources" | "source-kind";

const len = (s: string) => [...s].length;

/** 저장해도 되는 초안인가 — 제목 1~120자, 요약 300·적용 조건 1,000·본문 10,000자, 출처 1~50개 */
export function cardProblem(d: CardDraft): CardProblem | null {
  if (!CARD_TYPES.includes(d.type)) return "type";
  if (!CARD_STATUSES.includes(d.status)) return "status";
  const title = d.title.trim();
  if (!title || len(title) > CARD_LIMITS.title) return "title";
  if (len(d.summary) > CARD_LIMITS.summary) return "summary";
  if (len(d.conditions) > CARD_LIMITS.conditions) return "conditions";
  if (len(d.body) > CARD_LIMITS.body) return "body";
  const n = new Set(d.sources.map(sourceKey)).size;
  if (n < CARD_LIMITS.minSources || n > CARD_LIMITS.maxSources || n !== d.sources.length) return "sources";
  if (d.sources.some((s) => !CARD_SOURCE_KINDS.includes(s.kind))) return "source-kind";
  return null;
}

export const sourceKey = (s: { kind: CardSourceKind; sourceId: string; week?: WeekId | null }) =>
  [s.kind, s.week ?? "", s.sourceId].join("/");

/** 짧은 결정적 지문(FNV-1a 32비트 ×2) — 보안용이 아니라 "바뀌었나"만 본다 */
export function fingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ ((c << 3) | (c >>> 13)), 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** 지금 원문 상태(저장소가 읽어 준 것) — 없으면 null */
export interface SourceNow {
  text: string;
  /** 지문 재료: 항목 = 글·깊이·부모 글 / 메모 상자 = 본문·설명·URL·연결 / Cabinet = 제목·대상 */
  content: string;
  /** 위치 재료: 항목 = 날짜·업무 / 메모 상자 = 주 / 그 밖 = 빈 글 */
  location: string;
  locator: string;
}

export type SourceState = "ok" | "changed" | "moved" | "missing";

/** 출처마다 근거 상태: 일치 · 내용 변경 · 위치 변경(다른 날로 옮김) · 원문 없음 */
export function sourceState(
  s: Pick<CardSource, "contentFp" | "locationFp">,
  now: SourceNow | null,
): SourceState {
  if (!now) return "missing";
  if (fingerprint(now.content) !== s.contentFp) return "changed";
  if (fingerprint(now.location) !== s.locationFp) return "moved";
  return "ok";
}

/** 카드 전체 요약 배지 — 가장 나쁜 것(원문 없음 > 내용 변경 > 위치 변경 > 일치) */
export function worstState(states: SourceState[]): SourceState {
  for (const s of ["missing", "changed", "moved"] as const) if (states.includes(s)) return s;
  return "ok";
}

export const clip = (s: string, max: number) => ([...s].length > max ? [...s].slice(0, max).join("") : s);
