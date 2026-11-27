/* global AbortSignal, Buffer, URL */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export function createRedisCommand({ url, token, fetch }) {
  const endpoint = new URL(url);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash ||
    !token
  ) {
    throw Error("DEV_SESSION_STORE_REQUIRED");
  }
  return async (args) => {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(3500),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw Error("SESSION_STORE_UNAVAILABLE");
    const result = await response.json();
    if (result.error || !Object.hasOwn(result, "result")) throw Error("SESSION_STORE_UNAVAILABLE");
    return result.result;
  };
}

const rate =
  "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n";
const replace =
  "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL'); return 1";
const unlock = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]); end; return 0";

export function createSessionStore(command, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error("DEV_SESSION_ENCRYPTION_KEY_REQUIRED");
  const id = (prefix, raw) =>
    "wjb:web:dev:" +
    prefix +
    ":" +
    createHmac("sha256", key)
      .update(prefix + ":" + raw)
      .digest("hex");
  function encrypt(keyName, value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(keyName));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
  }
  function decode(keyName, version) {
    if (version === null) return null;
    const bytes = Buffer.from(version, "base64url");
    const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(keyName));
    cipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
    return { value, version };
  }
  return {
    async put(prefix, raw, value, seconds) {
      const k = id(prefix, raw);
      return command(["SET", k, encrypt(k, value), "EX", seconds]);
    },
    async get(prefix, raw) {
      const k = id(prefix, raw);
      return decode(k, await command(["GET", k]));
    },
    async take(prefix, raw) {
      const k = id(prefix, raw);
      return decode(k, await command(["GETDEL", k]));
    },
    async limit(prefix, raw, seconds) {
      return command(["EVAL", rate, 1, id(prefix, raw), seconds]);
    },
    async replaceSession(raw, previous, next) {
      const k = id("session", raw);
      return (await command(["EVAL", replace, 1, k, previous, encrypt(k, next)])) === 1;
    },
    async lock(raw, token) {
      return (await command(["SET", id("lock", raw), token, "NX", "EX", 30])) === "OK";
    },
    async unlock(raw, token) {
      await command(["EVAL", unlock, 1, id("lock", raw), token]);
    },
  };
}
