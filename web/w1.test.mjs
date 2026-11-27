/* global Buffer, Response, fetch, process */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { chromium } from "@playwright/test";
import { CLOUD_TARGETS } from "../poc/v2-cloud/cloud-environment.mjs";
import { createSessionStore } from "./session-store.mjs";
import { createDevUpstream } from "./upstream.mjs";
import { createWebHandler } from "./server.mjs";

const email = "invited@example.invalid";
const secondEmail = "second@example.invalid";
const secondId = "33333333-3333-4333-8333-333333333333";
const absent = "unlisted@example.invalid";
const accountId = "11111111-1111-4111-8111-111111111111";
const accounts = new Map([
  [email, accountId],
  [secondEmail, secondId],
]);
const spaceId = "22222222-2222-4222-8222-222222222222";
const code = "01234567";
const version = "web-dev-2026-11-27";

async function fixture(t) {
  const values = new Map();
  const sent = [];
  const devices = [];
  const revoked = [];
  const tokensByAccess = new Map();
  const tokensByRefresh = new Map();
  const deviceByAccount = new Map();
  let tokenCount = 0;
  function issue(address) {
    const index = tokenCount++;
    const tokens = {
      user: { id: accounts.get(address), email: address },
      access_token: "access-" + index,
      refresh_token: "refresh-" + index,
      expires_in: 60,
    };
    tokensByAccess.set("Bearer " + tokens.access_token, tokens.user);
    tokensByRefresh.set(tokens.refresh_token, tokens.user);
    return tokens;
  }
  let clock = Date.now();
  let allowed = true;
  let handler;
  const device = await createTestServer(t, (req, res) => handler(req, res));
  const { origin } = device;

  async function command([action, key, ...args]) {
    const value = values.get(key);
    switch (action) {
      case "GET":
        return value ?? null;
      case "GETDEL":
        values.delete(key);
        return value ?? null;
      case "SET":
        if (args[1] === "NX" && value !== undefined) return null;
        values.set(key, args[0]);
        return "OK";
      case "EVAL": {
        const [, redisKey, previous, next] = args;
        const existing = values.get(redisKey);
        if (key.includes("'INCR'")) {
          const count = (existing ?? 0) + 1;
          values.set(redisKey, count);
          return count;
        }
        if (existing !== previous) return 0;
        if (next !== undefined) values.set(redisKey, next);
        else values.delete(redisKey);
        return 1;
      }
      default:
        throw new Error("Unexpected command");
    }
  }

  const store = createSessionStore(command, Buffer.alloc(32, 7));
  const projectRef = CLOUD_TARGETS.development.projectRef;
  const upstream = createDevUpstream({
    projectRef,
    publicKey: "sb_publishable_test",
    now: () => clock,
    fetch: async (url, options) => {
      assert.equal(url.origin, "https://" + projectRef + ".supabase.co");
      assert.equal(options.headers.apikey, "sb_publishable_test");
      assert.equal(options.headers.origin, undefined);
      const body = options.body ? JSON.parse(options.body) : undefined;
      const user = tokensByAccess.get(options.headers.authorization);
      switch (url.pathname) {
        case "/auth/v1/otp":
          assert.deepEqual(body, { email: body.email, create_user: false });
          sent.push(body.email);
          return Response.json({}, { status: accounts.has(body.email) ? 200 : 422 });
        case "/auth/v1/verify":
          assert.equal(body.type, "email");
          if (!accounts.has(body.email) || body.token !== code) return Response.json({}, { status: 403 });
          return Response.json(issue(body.email));
        case "/auth/v1/token":
          assert.equal(url.searchParams.get("grant_type"), "refresh_token");
          assert.ok(tokensByRefresh.has(body.refresh_token));
          return Response.json(issue(tokensByRefresh.get(body.refresh_token).email));
        case "/auth/v1/logout":
          assert.equal(url.searchParams.get("scope"), "local");
          revoked.push(options.headers.authorization);
          return new Response(null, { status: 204 });
        case "/functions/v1/wjb-gateway/v2/me":
          assert.equal(options.method, "GET");
          assert.match(options.headers.authorization, /^Bearer access-/);
          return Response.json({ accountId: user.id, sessionActive: true, project: "development" });
        case "/functions/v1/wjb-gateway/v2/devices":
          assert.match(body.deviceId, /^[0-9a-f-]{36}$/);
          devices.push(body.deviceId);
          deviceByAccount.set(user.id, body.deviceId);
          return Response.json({ ...body, registered: true });
        case "/functions/v1/wjb-gateway/v2/read/list":
          assert.deepEqual(body, { deviceId: deviceByAccount.get(user.id), params: {} });
          if (!allowed) return Response.json({ error: "ACCESS_REVOKED" }, { status: 403 });
          return Response.json({
            workspaces:
              user.email === email
                ? [{ workspaceId: spaceId, workspace: { name: "검증 일지", color: "c4", path: "/private" } }]
                : [],
          });
        default:
          throw new Error("Unexpected upstream URL");
      }
    },
  });
  handler = createWebHandler({ origin, upstream, store, now: () => clock });
  return {
    origin,
    values,
    sent,
    devices,
    revoked,
    store,
    expireAccess: () => {
      clock += 35000;
    },
    deny: () => {
      allowed = false;
    },
    request: (path, { payload, cookies, requestOrigin = origin } = {}) => {
      const headers = cookies ? { cookie: cookies } : {};
      if (payload) Object.assign(headers, { "content-type": "application/json", origin: requestOrigin });
      return fetch(origin + path, {
        method: payload ? "POST" : "GET",
        headers,
        redirect: "manual",
        body: payload ? JSON.stringify(payload) : undefined,
      });
    },
  };
}

async function createTestServer(t, handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, "listening");
  return { origin: "http://127.0.0.1:" + server.address().port };
}

function cookies(response) {
  return response.headers
    .getSetCookie()
    .filter((value) => !value.includes("Max-Age=0"))
    .map((value) => value.split(";")[0])
    .join("; ");
}

test("DEV requests stay invite-only and public failures have the same outcome", async (t) => {
  const { request, sent } = await fixture(t);
  assert.equal((await request("/spaces")).headers.get("location"), "/login");
  assert.equal((await request("/api/spaces")).status, 401);
  assert.equal((await request("/terms")).status, 200);
  assert.equal((await request("/privacy")).status, 200);
  const payload = { email, agreed: true, version };
  assert.equal(
    (await request("/api/auth/code", { payload, requestOrigin: "https://elsewhere.invalid" })).status,
    403,
  );
  assert.equal((await request("/api/auth/code", { payload: { ...payload, agreed: false } })).status, 400);
  const registered = await request("/api/auth/code", { payload });
  const unlisted = await request("/api/auth/code", { payload: { ...payload, email: absent } });
  assert.deepEqual(sent, [email, absent]);
  assert.equal(registered.status, 202);
  assert.equal(unlisted.status, 202);
  assert.deepEqual(await registered.json(), await unlisted.json());
  const invalid = await request("/api/auth/verify", { payload: { code }, cookies: cookies(unlisted) });
  assert.deepEqual(await invalid.json(), { error: "CODE_REJECTED" });
  assert.equal(invalid.status, 401);
});

test("login scopes the space list, encrypts tokens, refreshes, reuses the device and revokes locally", async (t) => {
  const { request, values, devices, revoked, store, expireAccess, deny } = await fixture(t);
  async function signIn(deviceCookie = "", address = email) {
    const payload = { email: address, agreed: true, version };
    const issued = await request("/api/auth/code", { payload });
    const challenge = cookies(issued);
    const response = await request("/api/auth/verify", {
      payload: { code },
      cookies: [challenge, deviceCookie].filter(Boolean).join("; "),
    });
    assert.equal(response.status, 200);
    assert.equal((await request("/api/auth/verify", { payload: { code }, cookies: challenge })).status, 400);
    for (const header of response.headers.getSetCookie())
      assert.match(header, /Path=\/; Secure; HttpOnly; SameSite=Lax/);
    assert.doesNotMatch(await response.text(), /access-|refresh-/);
    return cookies(response);
  }

  const first = await signIn();
  const deviceCookie = first.split("; ").find((part) => part.startsWith("__Host-wjb_device="));
  assert.ok(deviceCookie);
  assert.equal((await store.get("consent", accountId)).value.version, version);
  assert.doesNotMatch(JSON.stringify([...values]), /access-|refresh-|invited@/);
  assert.equal((await request("/login", { cookies: first })).headers.get("location"), "/spaces");
  let response = await request("/api/spaces", { cookies: first });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    email,
    spaces: [{ id: spaceId, name: "검증 일지", color: "c4" }],
  });
  expireAccess();
  response = await request("/api/spaces", { cookies: first });
  assert.equal(response.status, 200);
  response = await request("/api/auth/logout", { payload: {}, cookies: first });
  assert.equal(response.status, 200);
  assert.deepEqual(revoked, ["Bearer access-1"]);
  assert.equal((await request("/api/spaces", { cookies: first })).status, 401);
  const second = await signIn(deviceCookie);
  assert.equal(devices.length, 2);
  assert.equal(devices[0], devices[1]);
  const otherAccount = await signIn(deviceCookie, secondEmail);
  assert.notEqual(devices[1], devices[2]);
  assert.deepEqual(await (await request("/api/spaces", { cookies: otherAccount })).json(), {
    email: secondEmail,
    spaces: [],
  });
  assert.equal((await request("/api/spaces", { cookies: second })).status, 200);
  deny();
  assert.equal((await request("/api/spaces", { cookies: second })).status, 401);
  assert.equal((await request("/spaces", { cookies: second })).headers.get("location"), "/login");
});

test(
  "Chromium completes the touch-width login, checks a second tab and signs out",
  {
    skip: !process.env.WJB_TEST_CHROMIUM,
  },
  async (t) => {
    const { origin } = await fixture(t);
    const browser = await chromium.launch({ executablePath: process.env.WJB_TEST_CHROMIUM });
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto(origin + "/login");
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.locator("html").evaluate((el) => el.scrollWidth), width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel("이메일", { exact: true }).fill(email);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "인증번호 받기" }).tap();
    await page.getByLabel("인증번호", { exact: true }).fill("11111111");
    await page.getByRole("button", { name: "로그인", exact: true }).tap();
    await page.getByRole("status").filter({ hasText: "인증번호를 확인해 주세요" }).waitFor();
    await page.getByLabel("인증번호", { exact: true }).fill(code);
    await page.getByRole("button", { name: "로그인", exact: true }).tap();
    await page.getByText("검증 일지").waitFor();
    const other = await context.newPage();
    await other.goto(origin + "/spaces");
    await other.getByText("검증 일지").waitFor();
    await page.getByRole("button", { name: "로그아웃", exact: true }).tap();
    await page.waitForURL("**/login");
    await other.reload();
    await other.waitForURL("**/login");
  },
);
