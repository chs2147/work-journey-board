/* global Buffer, URL, fetch, process */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createDevUpstream, WebError } from "./upstream.mjs";
import { createRedisCommand, createSessionStore } from "./session-store.mjs";
import { pageFor } from "./pages.mjs";

const termsVersion = "web-dev-2026-11-27";
const challengeAge = 60 * 60;
const sessionAge = 12 * 60 * 60;
const deviceAge = 365 * 24 * 60 * 60;
const cookieNames = {
  challenge: "__Host-wjb_challenge",
  session: "__Host-wjb_session",
  device: "__Host-wjb_device",
};
const nonce = () => randomBytes(32).toString("base64url");
const assets = new Map(
  [
    ["/assets/style.css", ["text/css; charset=utf-8", "./public/style.css"]],
    ["/assets/app.js", ["text/javascript; charset=utf-8", "./public/app.js"]],
    ["/assets/icon.svg", ["image/svg+xml", "../site/icon.svg"]],
    ["/assets/wordmark.svg", ["image/svg+xml", "../site/wordmark.svg"]],
  ].map(([route, [type, path]]) => [route, { type, body: readFileSync(new URL(path, import.meta.url)) }]),
);

function cookie(prefix, value = "", age = 0) {
  return `${cookieNames[prefix]}=${value}; Max-Age=${age}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}
function readCookie(request, prefix) {
  const name = cookieNames[prefix] + "=";
  const value = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name))
    ?.slice(name.length);
  return /^[\w-]{43}$/.test(value ?? "") ? value : null;
}
function browserDevice(account, browser) {
  const bytes = createHash("sha256").update(account).update(":").update(browser).digest();
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.subarray(0, 16).toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
function normalizeEmail(email) {
  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new WebError("INVALID_EMAIL", 400);
  }
  return email.trim().toLowerCase();
}
async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? ""))
    throw new WebError("INVALID_REQUEST", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 2048) throw new WebError("INVALID_REQUEST", 413);
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new WebError("INVALID_REQUEST", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WebError("INVALID_REQUEST", 400);
  return value;
}

export function createWebHandler({ origin, upstream, store, now = Date.now }) {
  const validatedOrigin = new URL(origin);
  if (
    origin !== validatedOrigin.origin ||
    !["https:", "http:"].includes(validatedOrigin.protocol) ||
    (validatedOrigin.protocol === "http:" && !["localhost", "127.0.0.1"].includes(validatedOrigin.hostname))
  ) {
    throw Error("DEV_WEB_ORIGIN_REQUIRED");
  }

  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };
  const redirect = (res, location) => res.writeHead(303, { location }).end();
  const revoke = async (access) => upstream.logout(access).catch(() => undefined);
  const limit = async (prefix, id, seconds, maximum) => {
    if ((await store.limit(prefix, id, seconds)) > maximum) throw new WebError("TRY_LATER", 429);
  };
  const activeSession = (session) =>
    session && session.value.expiresAt > now() && session.value.termsVersion === termsVersion;
  async function loadSession(key) {
    const current = key && (await store.get("session", key));
    if (!activeSession(current)) throw new WebError("SIGN_IN_REQUIRED", 401);
    return current;
  }
  async function sessionFor(key) {
    const { value } = await loadSession(key);
    if (value.accessUntil > now() + 30000) return value;
    const lock = nonce();
    if (!(await store.lock(key, lock))) throw new WebError("RETRY_SESSION", 503);
    try {
      const current = await loadSession(key);
      if (current.value.accessUntil > now() + 30000) return current.value;
      const next = await upstream.refresh(current.value.refresh);
      if (next.accountId !== current.value.accountId) {
        await revoke(next.access);
        throw new WebError("SIGN_IN_REQUIRED", 401);
      }
      const session = { ...current.value, ...next };
      if (!(await store.replaceSession(key, current.version, session))) {
        await revoke(next.access);
        throw new WebError("SIGN_IN_REQUIRED", 401);
      }
      return session;
    } finally {
      await store.unlock(key, lock).catch(() => undefined);
    }
  }
  async function listSpaces(key, res) {
    try {
      const session = await sessionFor(key);
      const spaces = await upstream.list(session);
      const present = await loadSession(key);
      if (present.value.accountId !== session.accountId) throw new WebError("SIGN_IN_REQUIRED", 401);
      return json(res, 200, { email: session.email, spaces });
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        if (key) await store.take("session", key);
        res.setHeader("set-cookie", cookie("session"));
      }
      throw error;
    }
  }

  async function sendCode(request, res) {
    const { email, agreed, version } = await readJson(request);
    const address = normalizeEmail(email);
    if (agreed !== true || version !== termsVersion) throw new WebError("CONSENT_REQUIRED", 400);
    // The daily OTP delivery capacity is shared with the desktop app.
    // Return the same response for known and unknown addresses, even when the address limit is reached.
    await limit("otp-global", "all", 3600, 20);
    if ((await store.limit("otp-email", address, 900)) <= 3) await upstream.send(address);
    const previous = readCookie(request, "challenge");
    if (previous) await store.take("challenge", previous);
    const id = nonce();
    await store.put("challenge", id, { email: address, termsVersion }, challengeAge);
    res.setHeader("set-cookie", cookie("challenge", id, challengeAge));
    return json(res, 202, { sent: true });
  }
  async function verifyCode(request, res) {
    const { code } = await readJson(request);
    if (typeof code !== "string" || !/^\d{8}$/.test(code)) throw new WebError("CODE_REJECTED", 400);
    const id = readCookie(request, "challenge");
    const challenge = id && (await store.get("challenge", id));
    if (!challenge || challenge.value.termsVersion !== termsVersion) throw new WebError("CODE_REJECTED", 400);
    await limit("otp-verify", challenge.value.email, 900, 8);
    await limit("otp-verify-global", "all", 900, 90);
    const tokens = await upstream.verify(challenge.value.email, code);
    try {
      if (!(await store.take("challenge", id)) || normalizeEmail(tokens.email) !== challenge.value.email) {
        throw new WebError("CODE_REJECTED", 400);
      }
      await upstream.check(tokens);
      const browser = readCookie(request, "device") ?? id;
      const deviceId = browserDevice(tokens.accountId, browser);
      await upstream.register(tokens.access, deviceId);
      const key = nonce();
      await store.put(
        "consent",
        tokens.accountId,
        { version: termsVersion, acceptedAt: now() },
        365 * 24 * 3600,
      );
      await store.put(
        "session",
        key,
        { ...tokens, deviceId, termsVersion, expiresAt: now() + sessionAge * 1000 },
        sessionAge,
      );
      res.setHeader("set-cookie", [
        cookie("challenge"),
        cookie("session", key, sessionAge),
        cookie("device", browser, deviceAge),
      ]);
      return json(res, 200, { signedIn: true });
    } catch (error) {
      await revoke(tokens.access);
      throw error;
    }
  }
  async function logout(request, res, key) {
    await readJson(request);
    const session = key && (await store.take("session", key));
    const challenge = readCookie(request, "challenge");
    if (challenge) await store.take("challenge", challenge);
    res.setHeader("set-cookie", [cookie("session"), cookie("challenge")]);
    if (session) {
      const { access, refresh, accessUntil } = session.value;
      if (accessUntil > now()) await revoke(access);
      else
        await upstream
          .refresh(refresh)
          .then((tokens) => revoke(tokens.access))
          .catch(() => undefined);
    }
    return json(res, 200, { signedIn: false });
  }

  return async (request, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-robots-tag", "noindex, nofollow");
    res.setHeader(
      "content-security-policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    try {
      const path = request.url;
      const key = readCookie(request, "session");
      if (request.method === "GET") {
        const asset = assets.get(path);
        if (asset) {
          res.writeHead(200, { "content-type": asset.type });
          return res.end(asset.body);
        }
        if (path === "/healthz") return json(res, 200, { status: "ok", channel: "development" });
        if (path === "/") return redirect(res, "/login");
        if (path === "/api/spaces") return await listSpaces(key, res);
        if (path === "/spaces" || path === "/login") {
          const session = key && (await store.get("session", key));
          const active = activeSession(session);
          if (path === "/spaces" && !active) return redirect(res, "/login");
          if (path === "/login" && active) return redirect(res, "/spaces");
        }
        const page = pageFor(path, termsVersion);
        if (page) {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(page);
        }
      }
      if (request.method === "POST") {
        if (request.headers.origin !== origin || request.headers["sec-fetch-site"] === "cross-site")
          throw new WebError("ORIGIN_REQUIRED", 403);
        if (path === "/api/auth/code" || path === "/api/auth/verify") {
          const session = key && (await store.get("session", key));
          if (activeSession(session)) throw new WebError("SIGN_OUT_FIRST", 409);
          return await (path.endsWith("/code") ? sendCode(request, res) : verifyCode(request, res));
        }
        if (path === "/api/auth/logout") return await logout(request, res, key);
      }
      return json(res, 404, { error: "NOT_FOUND" });
    } catch (error) {
      return json(res, error instanceof WebError ? error.status : 503, {
        error: error instanceof WebError ? error.message : "UNAVAILABLE",
      });
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const upstream = createDevUpstream({
    projectRef: env.WJB_SUPABASE_DEV_PROJECT_REF,
    publicKey: env.WJB_SUPABASE_DEV_PUBLISHABLE_KEY,
    fetch,
  });
  const command = createRedisCommand({
    url: env.WJB_WEB_REDIS_REST_URL,
    token: env.WJB_WEB_REDIS_REST_TOKEN,
    fetch,
  });
  const store = createSessionStore(command, Buffer.from(env.WJB_WEB_SESSION_KEY ?? "", "base64"));
  const server = createServer(
    { requestTimeout: 20000, headersTimeout: 10000 },
    createWebHandler({ origin: env.WJB_WEB_ORIGIN, upstream, store }),
  );
  server.listen(Number(env.PORT ?? 8080), "0.0.0.0", () =>
    process.stdout.write("Work Journey Board Web DEV ready\n"),
  );
}
