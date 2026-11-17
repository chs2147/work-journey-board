import { Buffer } from "node:buffer";
import { setTimeout, clearTimeout } from "node:timers";
/** 그림 한 장 최대(C-1b, docs/v2-design/82) — SQL 010의 asset_bytes_check와 같다. gateway 전체가 이 값 하나를 쓴다 */
export const MAX_ASSET_BYTES = 10485760;
export class GatewayError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export async function readLimited(source, limit, { timeoutMs = 5000 } = {}) {
  const declared = source.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    throw new GatewayError("INVALID_LENGTH");
  }
  if (declared !== null && Number(declared) > limit) throw new GatewayError("PAYLOAD_TOO_LARGE", 413);
  if (!source.body) return Buffer.alloc(0);
  const reader = source.body.getReader();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new GatewayError("BODY_TIMEOUT", 408));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new GatewayError("PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function scopeValid(scope) {
  return (
    uuid.test(scope.workspaceId) &&
    uuid.test(scope.assetId) &&
    uuid.test(scope.deviceId) &&
    typeof scope.generation === "string" &&
    /^[1-9][0-9]{0,18}$/.test(scope.generation) &&
    BigInt(scope.generation) <= 9223372036854775807n
  );
}

/**
 * G-4(docs/v2-design/99 4절): 서버 전용 열쇠 종류. 실서버는 새 비밀 키 `sb_secret_…`(apikey 머리에만)만 쓴다 — 개발은 예전
 * anon·service_role 키를 껐고, 운영은 처음부터 새 키만. "legacy"(apikey + Authorization)는 로컬 시험의 가짜 열쇠 판정용으로만 남는다.
 * 관리 토큰(`sbp_`)·공개 키·짧은 `sb_secret_`·빈 값은 null(서버 열쇠가 아님).
 */
export function serverKeyKind(key) {
  if (typeof key !== "string" || !key || /[\s\r\n]/.test(key)) return null;
  if (key.startsWith("sb_secret_")) return /^sb_secret_[A-Za-z0-9_-]{16,}$/.test(key) ? "secret" : null;
  // 관리 토큰·공개 키는 서버 열쇠가 아니다
  if (key.startsWith("sbp_") || key.startsWith("sb_publishable_")) return null;
  return "legacy";
}
/** 서버 열쇠를 보내는 머리 — 새 비밀 키는 Authorization에 넣으면 JWT로 읽혀 거절되므로 apikey만 */
export function serverKeyHeaders(key) {
  const kind = serverKeyKind(key);
  if (!kind) throw new TypeError("Server key required");
  return kind === "secret" ? { apikey: key } : { apikey: key, authorization: `Bearer ${key}` };
}
