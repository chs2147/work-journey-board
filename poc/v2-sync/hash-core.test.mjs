import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { sha256Hex, hash, canonical, base64ToBytes, bytesToBase64 } from "./hash-core.mjs";
import { hash as nodeHash } from "./model.mjs";

const ref = (b) => createHash("sha256").update(b).digest("hex");
test("SHA-256 matches node:crypto across block boundaries", () => {
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 65537]) {
    const b = randomBytes(n);
    assert.equal(sha256Hex(new Uint8Array(b)), ref(b), `len ${n}`);
  }
  assert.equal(
    sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
test("hash equals model.mjs hash for strings, bytes and JSON values", () => {
  const values = [
    "",
    "한글 업무",
    { b: 1, a: [null, true, "x", 1.5], 가: { z: -0, y: "\u0000" } },
    [],
    42,
    null,
  ];
  for (const v of values) assert.equal(hash(v), nodeHash(v));
  const b = randomBytes(300);
  assert.equal(hash(new Uint8Array(b)), nodeHash(b));
  assert.equal(canonical({ b: 1, a: 2 }), '{"a":2,"b":1}');
});
test("base64 round trip equals Buffer", () => {
  for (const n of [0, 1, 2, 3, 4, 100, 4097]) {
    const b = randomBytes(n),
      text = b.toString("base64");
    assert.equal(bytesToBase64(new Uint8Array(b)), text);
    assert.deepEqual(Buffer.from(base64ToBytes(text)), b);
  }
  assert.equal(base64ToBytes("ab$c").length, 0);
});
