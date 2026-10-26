// 업무 태그(docs/improve-1026-spec.md 4~6절). 순수 함수만 — 이름 정리·검증, 태그 필터(OR), 칩 줄이기.
export interface Tag {
  id: string;
  name: string;
  sortOrder: number;
}

export const TAG_NAME_MAX = 20;
/** 필터의 "태그 없음" 항목 */
export const NO_TAG = "__none__";
/** 업무 머리에 보일 칩 수 — 넘치면 `+2` */
export const TAG_CHIPS_MAX = 3;

/** 앞의 `#`·앞뒤 공백을 떼고 안쪽 공백은 하나로 */
export function normalizeTagName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^#+\s*/, "")
    .trim();
}

/** 이름 문제(없으면 null). existing = 다른 태그 이름들(대소문자 무시 중복 금지) */
export function tagNameProblem(name: string, existing: readonly string[]): string | null {
  if (!name) return "태그 이름을 입력하세요";
  if (name.length > TAG_NAME_MAX) return `태그 이름은 ${TAG_NAME_MAX}자까지입니다`;
  const low = name.toLowerCase();
  if (existing.some((e) => e.toLowerCase() === low)) return `이미 있는 태그입니다: #${name}`;
  return null;
}

/** 이름으로 태그 찾기(대소문자 무시) */
export const findTagByName = (tags: readonly Tag[], name: string): Tag | undefined =>
  tags.find((t) => t.name.toLowerCase() === normalizeTagName(name).toLowerCase());

/**
 * 태그 필터(spec 6-1): 고른 태그가 **하나라도** 붙은 업무만(OR). `NO_TAG`를 고르면 태그 없는 업무도.
 * 고른 것이 없으면 모두 보인다.
 */
export function matchesTagFilter(tagIds: readonly string[], filter: readonly string[]): boolean {
  if (filter.length === 0) return true;
  if (tagIds.length === 0) return filter.includes(NO_TAG);
  return tagIds.some((id) => filter.includes(id));
}

/** 업무 머리 칩: 앞에서 TAG_CHIPS_MAX개 + 나머지 수 */
export function chipsToShow<T>(tags: readonly T[], max = TAG_CHIPS_MAX): { shown: T[]; more: number } {
  return { shown: tags.slice(0, max), more: Math.max(0, tags.length - max) };
}

/** 필터 단추 글: `#프로젝트A` / `#프로젝트A 외 1` (없는 태그는 빼고) */
export function filterLabel(filter: readonly string[], tags: readonly Tag[], noTagLabel: string): string {
  const names = filter.flatMap((id) => {
    if (id === NO_TAG) return [noTagLabel];
    const t = tags.find((x) => x.id === id);
    return t ? [`#${t.name}`] : [];
  });
  if (names.length === 0) return "";
  return names.length === 1 ? names[0]! : `${names[0]} 외 ${names.length - 1}`;
}
