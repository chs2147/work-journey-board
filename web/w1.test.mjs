/* global Response, URL, fetch, process */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { chromium } from "@playwright/test";
import { CLOUD_TARGETS } from "../poc/v2-cloud/cloud-environment.mjs";
import { connectWebDatabase, createSessionStore } from "./session-store.mjs";
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
const manifest = "a".repeat(64);
const itemKey = "b".repeat(64);
const categoryKey = "c".repeat(64);
const sectionKey = "d".repeat(64);
const summaryKey = "e".repeat(64);
const currentDate = new Date();
const fixtureDate = new Date(
  Date.UTC(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()),
)
  .toISOString()
  .slice(0, 10);
const entryFixture = {
  id: "entry-a",
  date: fixtureDate,
  category_id: "category-a",
  seq: 1,
  depth: 0,
  text: "기준 스냅샷",
  flagged: 0,
  flag_done_at: null,
  kanban_section_id: "parking",
  updated_at: "2026-01-01T00:00:00.000Z",
  unknown_field: "보존 대상",
};
const version = "web-dev-2026-11-27";
const databaseUrl = new URL(process.env.WJB_WEB_TEST_DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(databaseUrl.hostname) || databaseUrl.pathname !== "/wj_web_test") {
  throw new Error("Use the disposable local wj_web_test database");
}

async function fixture(t) {
  const sent = [];
  let row = { ...entryFixture, text: "데스크탑 최신 기록" };
  let seq = 1;
  const operations = new Map();
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

  const projectRef = CLOUD_TARGETS.development.projectRef;
  const sql = connectWebDatabase(databaseUrl, { projectRef, allowLocal: true });
  t.after(() => sql.end({ timeout: 1 }));
  const store = createSessionStore(sql, randomBytes(32));
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
        case "/functions/v1/wjb-gateway/v2/read/header":
        case "/functions/v1/wjb-gateway/v2/read/records":
        case "/functions/v1/wjb-gateway/v2/sync/pull":
        case "/functions/v1/wjb-gateway/v2/sync/push": {
          if (body.params.workspaceId !== spaceId || user.email !== email)
            return Response.json({ error: "READ_NOT_FOUND" }, { status: 404 });
          assert.equal(body.deviceId, deviceByAccount.get(user.id));
          if (url.pathname.endsWith("/header"))
            return Response.json({
              workspaceId: spaceId,
              manifestHash: manifest,
              header: { sourceSchema: 20 },
            });
          if (url.pathname.endsWith("/records")) {
            assert.equal(body.params.manifestHash, manifest);
            if (body.params.after) {
              assert.deepEqual(body.params.after, ["entry_item", itemKey]);
              return Response.json({
                records: [
                  {
                    table: "kanban_section",
                    key: sectionKey,
                    value: { id: "parking", name: "파킹랏", sort_order: 0 },
                  },
                  {
                    table: "weekly_summary",
                    key: summaryKey,
                    value: { week_id: "2026-W01", edited_text: "보관된 요약" },
                  },
                ],
                more: false,
                next: null,
              });
            }
            return Response.json({
              records: [
                { table: "category", key: categoryKey, value: { id: "category-a", name: "프로젝트" } },
                { table: "entry_item", key: itemKey, value: entryFixture },
              ],
              more: true,
              next: ["entry_item", itemKey],
            });
          }
          if (url.pathname.endsWith("/pull")) {
            const after = Number(body.params.after);
            return Response.json({
              changes:
                after < seq
                  ? [{ table: "entry_item", key: itemKey, value: row, rev: seq, seq: String(seq) }]
                  : [],
              more: false,
              next: String(seq),
            });
          }
          const { opId, changes, kanbanMove } = body.params;
          if (kanbanMove) {
            assert.equal(kanbanMove.key, itemKey);
            if (operations.has(opId)) {
              assert.deepEqual(operations.get(opId), kanbanMove);
              return Response.json({ applied: true, replayed: true });
            }
            if (kanbanMove.baseRev !== seq) return Response.json({ applied: false });
            assert.equal(kanbanMove.to, "done");
            operations.set(opId, kanbanMove);
            row = { ...row, flagged: 0, flag_done_at: new Date().toISOString(), kanban_section_id: null };
            seq++;
            return Response.json({ applied: true });
          }
          if (operations.has(opId)) {
            assert.deepEqual(operations.get(opId), changes);
            return Response.json({ applied: true, replayed: true });
          }
          assert.equal(changes.length, 1);
          const change = changes[0];
          assert.equal(change.key, itemKey);
          assert.equal(change.table, "entry_item");
          if (change.baseRev !== seq) return Response.json({ applied: false, conflicts: [] });
          assert.equal(change.value.unknown_field, "보존 대상");
          assert.equal(change.value.kanban_section_id, "parking");
          operations.set(opId, changes);
          row = change.value;
          seq++;
          return Response.json({ applied: true });
        }
        default:
          throw new Error("Unexpected upstream URL");
      }
    },
  });
  handler = createWebHandler({ origin, upstream, store, now: () => clock });
  return {
    origin,
    sql,
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
  for (const path of [
    "/",
    "/spaces",
    "/app/example/day",
    "/settings/account",
    "/?profile=local-dev&sample=year",
  ]) {
    assert.equal((await request(path)).headers.get("location"), "/login");
  }
  const health = await (await request("/healthz")).json();
  assert.equal(health.app, "work-journey-board-web");
  assert.equal((await request("/api/spaces/example")).status, 401);
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
  const { request, sql, devices, revoked, expireAccess, deny } = await fixture(t);
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
  const [consent] = await sql`select terms_version from wj_web.consent where account_id = ${accountId}`;
  assert.equal(consent.terms_version, version);
  const stored = await sql`select payload from wj_web.session where account_id = ${accountId}`;
  assert.ok(stored.length);
  assert.doesNotMatch(JSON.stringify(stored), /access-|refresh-|invited@/);
  assert.equal((await request("/login", { cookies: first })).headers.get("location"), "/spaces");
  assert.equal((await request("/", { cookies: first })).headers.get("location"), "/spaces");
  assert.equal((await request("/api/spaces/example", { cookies: first })).status, 404);
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

test("workspace routes page current data, preserve record fields and reject stale edits", async (t) => {
  const { request } = await fixture(t);
  assert.equal((await request(`/api/spaces/${spaceId}/header`)).status, 401);
  async function connect(address) {
    const issued = await request("/api/auth/code", { payload: { email: address, agreed: true, version } });
    const signedIn = await request("/api/auth/verify", { payload: { code }, cookies: cookies(issued) });
    assert.equal(signedIn.status, 200);
    return cookies(signedIn);
  }
  const owner = await connect(email);
  const other = await connect(secondEmail);
  const api = `/api/spaces/${spaceId}`;
  assert.equal((await request(api + "/header", { cookies: other })).status, 404);
  const header = await (await request(api + "/header", { cookies: owner })).json();
  assert.deepEqual(header, { name: "검증 일지", manifest, schema: 20 });
  const first = await (await request(api + "/records?manifest=" + manifest, { cookies: owner })).json();
  assert.deepEqual(first.next, ["entry_item", itemKey]);
  const next = await (
    await request(api + "/records?manifest=" + manifest + "&table=entry_item&key=" + itemKey, {
      cookies: owner,
    })
  ).json();
  assert.equal(next.records[0].value.name, "파킹랏");
  const snapshot = first.records.find((record) => record.key === itemKey);
  assert.equal(snapshot.value.text, "기준 스냅샷");
  assert.equal(snapshot.value.unknown_field, undefined);
  const changes = await (await request(api + "/changes?after=0", { cookies: owner })).json();
  const latest = changes.records[0];
  assert.equal(latest.value.text, "데스크탑 최신 기록");
  assert.equal((await request(`/app/${spaceId}/week`, { cookies: owner })).status, 200);
  const draft = {
    text: "웹에서 저장",
    edit: latest.edit,
    editedAt: new Date().toISOString(),
    opId: randomUUID(),
  };
  assert.equal((await request(api + "/text", { cookies: other, payload: draft })).status, 400);
  assert.equal(
    (await request(api + "/text", { cookies: owner, payload: { ...draft, edit: snapshot.edit } })).status,
    409,
  );
  assert.equal((await request(api + "/text", { cookies: owner, payload: draft })).status, 200);
  assert.equal((await request(api + "/text", { cookies: owner, payload: draft })).status, 200);
  const saved = await (await request(api + "/changes?after=1", { cookies: owner })).json();
  assert.equal(saved.records[0].value.text, "웹에서 저장");
  const move = { to: "done", edit: saved.records[0].edit, opId: randomUUID() };
  assert.equal((await request(api + "/move", { cookies: other, payload: move })).status, 400);
  assert.equal(
    (await request(api + "/move", { cookies: owner, payload: { ...move, edit: latest.edit } })).status,
    409,
  );
  assert.equal((await request(api + "/move", { cookies: owner, payload: move })).status, 200);
  assert.equal((await request(api + "/move", { cookies: owner, payload: move })).status, 200);
  const moved = await (await request(api + "/changes?after=2", { cookies: owner })).json();
  assert.ok(moved.records[0].value.flag_done_at);
  assert.equal(moved.records[0].value.kanban_section_id, null);
});

test("Postgres reserves one refresh and cannot revive a deleted session", async (t) => {
  const { sql, store } = await fixture(t);
  const id = randomUUID();
  const value = { accountId, termsVersion: version, refresh: "private-fixture" };
  await store.saveLogin(id, value, 60);
  const current = await store.getSession(id);
  const locks = [randomUUID(), randomUUID()];
  const winners = await Promise.all(locks.map((lock) => store.claimRefresh(id, current.generation, lock)));
  assert.equal(winners.filter(Boolean).length, 1);
  const lock = locks[winners.indexOf(true)];
  assert.equal((await store.takeSession(id)).refreshing, true);
  assert.equal(await store.finishRefresh(id, current.generation, lock, value), null);
  assert.equal(await store.getSession(id), null);

  const challengeId = randomUUID();
  await store.putChallenge(challengeId, { email }, 60);
  const consumed = await Promise.all([store.takeChallenge(challengeId), store.takeChallenge(challengeId)]);
  assert.equal(consumed.filter(Boolean).length, 1);
  const rate = await Promise.all([store.limit("fixture", id, 60), store.limit("fixture", id, 60)]);
  assert.deepEqual(rate.sort(), [1, 2]);

  await store.saveLogin(id, value, 60);
  assert.equal(await store.claimRefresh(id, current.generation, lock), true);
  await sql`update wj_web.session set lock_until = now() - interval '1 second' where lock_owner = ${lock}`;
  assert.equal(await store.claimRefresh(id, current.generation, randomUUID()), false);
  assert.equal(await store.expireRefresh(id, current.generation), true);
  assert.equal(await store.getSession(id), null);
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
    await other.getByRole("link", { name: "검증 일지" }).tap();
    await other.getByText("데스크탑 최신 기록").waitFor();
    assert.equal(await other.locator("html").evaluate((el) => el.scrollWidth), 390);
    await other.getByRole("link", { name: "칸반" }).tap();
    await other.getByRole("heading", { name: "파킹랏" }).waitFor();
    await other.getByRole("button", { name: /기록 편집/ }).tap();
    await other.getByRole("textbox", { name: "기록 편집", exact: true }).fill("모바일에서 바꾼 기록");
    await other.getByRole("button", { name: "서버에 저장" }).tap();
    await other.getByText("모바일에서 바꾼 기록").waitFor();
    await other.getByRole("combobox", { name: /이동할 섹션/ }).selectOption("done");
    await other.getByRole("button", { name: "이동", exact: true }).tap();
    await other
      .locator(".journal-group")
      .filter({ has: other.getByRole("heading", { name: "DONE", exact: true }) })
      .getByText("모바일에서 바꾼 기록")
      .waitFor();
    await other.getByRole("link", { name: "주간", exact: true }).tap();
    await other.getByText("모바일에서 바꾼 기록").waitFor();
    await other.getByRole("link", { name: "검색", exact: true }).tap();
    await other.getByLabel("기록 검색").fill("모바일");
    await other.getByText("모바일에서 바꾼 기록").waitFor();
    await other.getByRole("link", { name: "요약", exact: true }).tap();
    await other.getByText(/주간 요약/).waitFor();
    const downloaded = other.waitForEvent("download");
    await other.getByRole("button", { name: "Markdown 다운로드" }).tap();
    assert.match((await downloaded).suggestedFilename(), /^\d{4}-W\d{2}-summary\.md$/);
    await page.getByRole("button", { name: "로그아웃", exact: true }).tap();
    await page.waitForURL("**/login");
    await other.waitForURL("**/login");
    await other.goBack();
    assert.notEqual(new URL(other.url()).pathname, "/spaces");
  },
);
