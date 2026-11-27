/* global Buffer, URL, fetch, process */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createDevUpstream, WebError } from "./upstream.mjs";
import { connectWebDatabase, createSessionStore } from "./session-store.mjs";
import { pageFor } from "./pages.mjs";
import { createWorkspaceAccess, workspaceIdPattern, workspaceViews } from "./workspace.mjs";

const termsVersion = "web-dev-2026-11-27";
const challengeAge = 60 * 60;
const sessionAge = 12 * 60 * 60;
const deviceAge = 365 * 24 * 60 * 60;
const jsonLimit = 2048;
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
    ["/assets/workspace.js", ["text/javascript; charset=utf-8", "./public/workspace.js"]],
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
async function readJson(request, limit = jsonLimit) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? ""))
    throw new WebError("INVALID_REQUEST", 415);
  if (Number(request.headers["content-length"]) > limit) throw new WebError("INVALID_REQUEST", 413);

  let body;
  try {
    body = request.body; // The Vercel Node.js helper may already have read the stream.
  } catch {
    throw new WebError("INVALID_REQUEST", 400);
  }
  if (body === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > limit) throw new WebError("INVALID_REQUEST", 413);
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  }

  const raw = Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body);
  if (Buffer.byteLength(raw) > limit) throw new WebError("INVALID_REQUEST", 413);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new WebError("INVALID_REQUEST", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WebError("INVALID_REQUEST", 400);
  return value;
}

export function createWebHandler({
  origin,
  upstream,
  store,
  now = Date.now,
  revision = "local",
  workspaceKey = randomBytes(32),
}) {
  const validatedOrigin = new URL(origin);
  const workspaces = createWorkspaceAccess(upstream, workspaceKey);
  const workspaceApi = new RegExp(`^/api/spaces/(${workspaceIdPattern})/(header|records|changes|text|move)$`);
  const workspacePage = new RegExp(`^/app/(${workspaceIdPattern})/(${workspaceViews})$`);
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
    const current = key && (await store.getSession(key));
    if (!activeSession(current)) throw new WebError("SIGN_IN_REQUIRED", 401);
    return current;
  }
  async function sessionFor(key) {
    const current = await loadSession(key);
    if (current.value.accessUntil > now() + 30000) return current;
    const lock = nonce();
    if (!(await store.claimRefresh(key, current.generation, lock))) {
      const latest = await loadSession(key);
      if (latest.value.accessUntil > now() + 30000) return latest;
      if (await store.expireRefresh(key, latest.generation)) throw new WebError("SIGN_IN_REQUIRED", 401);
      throw new WebError("RETRY_SESSION", 503);
    }

    let next;
    try {
      next = await upstream.refresh(current.value.refresh);
      if (next.accountId !== current.value.accountId) throw new WebError("SIGN_IN_REQUIRED", 401);
      const session = await store.finishRefresh(key, current.generation, lock, { ...current.value, ...next });
      if (session) return session;
    } catch {
      // A timeout may have consumed the provider's refresh token.
      // Remove this generation so another instance never replays the token.
      await store.dropSession(key, current.generation).catch(() => undefined);
    }
    if (next) await revoke(next.access);
    throw new WebError("SIGN_IN_REQUIRED", 401);
  }

  async function withSession(key, run) {
    const session = await sessionFor(key);
    let result;
    try {
      result = await run(session.value);
    } catch (error) {
      if (error.status === 401) {
        const removed = await store.dropSession(key, session.generation);
        if (!removed && activeSession(await store.getSession(key))) throw new WebError("RETRY_SESSION", 503);
      }
      throw error;
    }
    const present = await loadSession(key);
    if (present.value.accountId !== session.value.accountId) throw new WebError("SIGN_IN_REQUIRED", 401);
    return result;
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
    if (previous) await store.takeChallenge(previous);
    const id = nonce();
    await store.putChallenge(id, { email: address, termsVersion }, challengeAge);
    res.setHeader("set-cookie", cookie("challenge", id, challengeAge));
    return json(res, 202, { sent: true });
  }
  async function verifyCode(request, res) {
    const { code } = await readJson(request);
    if (typeof code !== "string" || !/^\d{8}$/.test(code)) throw new WebError("CODE_REJECTED", 400);
    const id = readCookie(request, "challenge");
    const challenge = id && (await store.getChallenge(id));
    if (!challenge || challenge.termsVersion !== termsVersion) throw new WebError("CODE_REJECTED", 400);
    await limit("otp-verify", challenge.email, 900, 8);
    await limit("otp-verify-global", "all", 900, 90);
    const tokens = await upstream.verify(challenge.email, code);
    try {
      if (!(await store.takeChallenge(id)) || normalizeEmail(tokens.email) !== challenge.email) {
        throw new WebError("CODE_REJECTED", 400);
      }
      await upstream.check(tokens);
      const browser = readCookie(request, "device") ?? id;
      const deviceId = browserDevice(tokens.accountId, browser);
      await upstream.register(tokens.access, deviceId);
      const key = nonce();
      await store.saveLogin(
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
    const session = key && (await store.takeSession(key));
    const challenge = readCookie(request, "challenge");
    if (challenge) await store.takeChallenge(challenge);
    res.setHeader("set-cookie", [cookie("session"), cookie("challenge")]);
    if (session) {
      const { access, refresh, accessUntil } = session.value;
      if (accessUntil > now()) await revoke(access);
      else if (!session.refreshing)
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
      const { pathname: path, searchParams } = new URL(request.url, origin);
      const key = readCookie(request, "session");
      const space = path.match(workspaceApi);
      const view = path.match(workspacePage);
      if (request.method === "GET") {
        const asset = assets.get(path);
        if (asset) {
          res.writeHead(200, { "content-type": asset.type });
          return res.end(asset.body);
        }
        if (path === "/healthz") {
          return json(res, 200, {
            status: "ok",
            app: "work-journey-board-web",
            channel: "development",
            revision,
          });
        }
        if (path === "/api/spaces") {
          const result = await withSession(key, async (session) => ({
            email: session.email,
            spaces: await upstream.list(session),
          }));
          return json(res, 200, result);
        }
        if (space && ["header", "records", "changes"].includes(space[2])) {
          const [, id, type] = space;
          const result = await withSession(key, (session) =>
            type === "header" ? workspaces.open(session, id) : workspaces[type](session, id, searchParams),
          );
          return json(res, 200, result);
        }
        if (path.startsWith("/api/spaces/")) await loadSession(key);
        const webPage =
          path === "/app" ||
          path.startsWith("/app/") ||
          path === "/settings" ||
          path.startsWith("/settings/");
        if (path === "/" || path === "/spaces" || path === "/login" || webPage) {
          const active = activeSession(key && (await store.getSession(key)));
          if (path === "/" || (webPage && !view)) return redirect(res, active ? "/spaces" : "/login");
          if (view && !active) return redirect(res, "/login");
          if (path === "/spaces" && !active) return redirect(res, "/login");
          if (path === "/login" && active) return redirect(res, "/spaces");
        }
        const page = pageFor(path, termsVersion, view);
        if (page) {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(page);
        }
      }
      if (request.method === "POST") {
        if (request.headers.origin !== origin || request.headers["sec-fetch-site"] === "cross-site")
          throw new WebError("ORIGIN_REQUIRED", 403);
        if (space && ["text", "move"].includes(space[2])) {
          const payload = await readJson(request, 30000);
          const action = space[2] === "text" ? workspaces.saveText : workspaces.moveCard;
          const result = await withSession(key, (session) => action(session, space[1], payload));
          return json(res, 200, result);
        }
        if (path === "/api/auth/code" || path === "/api/auth/verify") {
          const session = key && (await store.getSession(key));
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

export function createConfiguredWebHandler(env) {
  const upstream = createDevUpstream({
    projectRef: env.WJB_SUPABASE_DEV_PROJECT_REF,
    publicKey: env.WJB_SUPABASE_DEV_PUBLISHABLE_KEY,
    fetch,
  });
  const sql = connectWebDatabase(env.WJB_WEB_DATABASE_URL, {
    projectRef: env.WJB_SUPABASE_DEV_PROJECT_REF,
    allowLocal: !env.VERCEL_ENV || env.VERCEL_ENV === "development",
    certificate: env.WJB_WEB_DB_CA,
  });
  const workspaceKey = Buffer.from(env.WJB_WEB_SESSION_KEY ?? "", "base64");
  const store = createSessionStore(sql, workspaceKey);
  const revision = /^[0-9a-f]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? "")
    ? env.VERCEL_GIT_COMMIT_SHA
    : "local";
  return createWebHandler({ origin: env.WJB_WEB_ORIGIN, upstream, store, revision, workspaceKey });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer(
    { requestTimeout: 20000, headersTimeout: 10000 },
    createConfiguredWebHandler(process.env),
  );
  server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0", () =>
    process.stdout.write("Work Journey Board Web DEV ready\n"),
  );
}
