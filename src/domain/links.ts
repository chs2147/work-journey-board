// 링크(improve-1026-spec 9·10절). 순수 함수만 — 글 속 주소 찾기, 열 수 있는 주소 판정, 화면용 줄임, 링크 카드의 제목·도메인.
// 앱은 주소에 접속하지 않는다: 여는 것은 OS 기본 브라우저(Rust open_url이 한 번 더 검사), 카드는 사용자가 쓴 제목·메모만(13절).

/** 주소 최대 길이 */
export const URL_MAX = 2048;
/** 링크 카드 제목·메모 최대 길이 */
export const LINK_TEXT_MAX = 200;

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`]+/gi;
/** 주소 끝에 붙은 문장 부호는 주소가 아니다(괄호는 짝이 맞을 때만 주소) */
const TRAILING = /[.,;:!?…'"」』)\]]+$/;

/** http/https 주소이고 너무 길지 않으며 공백·제어 문자가 없는가 — 그 밖(파일·스크립트 주소 등)은 열지 않는다 */
export function isOpenableUrl(raw: string): boolean {
  if (
    !raw ||
    raw.length > URL_MAX ||
    /\s/.test(raw) ||
    [...raw].some((c) => c.charCodeAt(0) < 32 || c === "\u007f")
  )
    return false;
  if (!/^https?:\/\//i.test(raw)) return false;
  try {
    const u = new URL(raw);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

function trimUrl(url: string): string {
  let u = url;
  for (;;) {
    const m = TRAILING.exec(u);
    if (!m) return u;
    // 닫는 괄호는 주소 안에 여는 괄호가 있으면 주소의 일부
    const tail = m[0];
    let cut = tail.length;
    if (tail.endsWith(")") && (u.match(/\(/g)?.length ?? 0) >= (u.match(/\)/g)?.length ?? 0)) cut -= 1;
    if (cut <= 0) return u;
    u = u.slice(0, u.length - cut);
  }
}

export interface TextSegment {
  text: string;
  /** 링크이면 그 주소(글자 그대로) */
  url?: string;
}

/** 글을 주소/글 조각으로 나눈다 — 조각을 이어 붙이면 원래 글과 같다 */
export function splitLinks(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_IN_TEXT)) {
    const url = trimUrl(m[0]);
    if (!isOpenableUrl(url)) continue;
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ text: url, url });
    last = at + url.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export const hasLink = (text: string) => splitLinks(text).some((s) => s.url);

/** 화면용으로 긴 주소의 가운데를 줄인다(마우스를 올리면 전체 주소) */
export function shortUrl(url: string, max = 48): string {
  if (url.length <= max) return url;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  return `${url.slice(0, head)}…${url.slice(url.length - (keep - head))}`;
}

/** `wiki.example.local` (앞의 www. 뺌) */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/** 제목을 비우면 주소에서 만든다: 경로 끝 두 마디(`deploy/checklist`), 경로가 없으면 도메인 */
export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname
      .split("/")
      .filter(Boolean)
      .map((p) => {
        try {
          return decodeURIComponent(p);
        } catch {
          return p;
        }
      });
    const t = parts.length ? parts.slice(-2).join("/") : domainOf(url);
    return t.slice(0, LINK_TEXT_MAX);
  } catch {
    return url.slice(0, LINK_TEXT_MAX);
  }
}

/** 카드 왼쪽 정사각의 글자(도메인 첫 글자, 대문자) */
export const domainInitial = (url: string) =>
  (domainOf(url).match(/[\p{L}\p{N}]/u)?.[0] ?? "#").toUpperCase();

/** 도메인별 고정 색조 1~6(같은 도메인은 늘 같은 색) */
export function domainTone(url: string): number {
  let h = 0;
  for (const ch of domainOf(url)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 6) + 1;
}

/** 붙여 넣은 글이 주소 하나뿐인가(앞뒤 공백 무시) → 그 주소 */
export function singleUrl(text: string): string | null {
  const t = text.trim();
  return isOpenableUrl(t) ? t : null;
}
