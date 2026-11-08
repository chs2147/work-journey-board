import { Buffer } from "node:buffer";
import { setTimeout, clearTimeout } from "node:timers";
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
