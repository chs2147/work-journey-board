// 정준 JSON·SHA-256 — 순수 핵심(Node 가져오기 없음, docs/v2-design/84).
// model.mjs hash와 같은 값: 문자열·바이트는 그대로, 그 밖은 키를 정렬한 정준 JSON의 UTF-8.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** SHA-256(동기) → 소문자 16진 64자 */
export function sha256Hex(bytes) {
  if (!(bytes instanceof Uint8Array)) throw TypeError("BYTES_REQUIRED");
  const n = bytes.length,
    total = (((n + 9 + 63) >>> 6) << 6) >>> 0,
    buf = new Uint8Array(total);
  buf.set(bytes);
  buf[n] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor(n / 0x20000000), false);
  view.setUint32(total - 4, (n << 3) >>> 0, false);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15],
        b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0],
      b = h[1],
      c = h[2],
      d = h[3],
      e = h[4],
      f = h[5],
      g = h[6],
      k = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (k + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += k;
  }
  let out = "";
  for (let i = 0; i < 8; i++)
    out += HEX[h[i] >>> 24] + HEX[(h[i] >>> 16) & 255] + HEX[(h[i] >>> 8) & 255] + HEX[h[i] & 255];
  return out;
}

/** model.mjs canonical과 같은 규칙(키 정렬 = 기본 sort, 값 = JSON.stringify) */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof Uint8Array))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

const encoder = new TextEncoder();
/** 문자열 = UTF-8 그대로, 바이트 = 그대로, 그 밖 = 정준 JSON */
export function hash(value) {
  if (value instanceof Uint8Array) return sha256Hex(value);
  return sha256Hex(encoder.encode(typeof value === "string" ? value : canonical(value)));
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64_INDEX[B64.charCodeAt(i)] = i;
/** 엄격하지 않은 해석은 하지 않는다 — 다시 인코딩해 원문과 비교하는 쪽(copy-core)이 걸러 낸다. 잘못된 글자면 빈 바이트 */
export function base64ToBytes(text) {
  const clean = text.replace(/=+$/, "");
  if (clean.length % 4 === 1) return new Uint8Array(0);
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0,
    acc = 0,
    j = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i),
      v = c < 128 ? B64_INDEX[c] : -1;
    if (v < 0) return new Uint8Array(0);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (acc >>> bits) & 255;
    }
  }
  return out.subarray(0, j);
}
export function bytesToBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i],
      b = bytes[i + 1],
      c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : B64[c & 63];
  }
  return out;
}
