import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, fork } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import process from "node:process";
import { setTimeout, clearTimeout } from "node:timers";
import { generateKeyPair, exportJWK, SignJWT } from "../v2-auth/test-jose.mjs";

const runId = randomUUID().replaceAll("-", "");
const container = "wjb-durable-" + runId.slice(0, 12),
  volume = "wjb-durable-data-" + runId;
const image = "postgres@sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994";
const env = { ...process.env };
for (const name of Object.keys(env))
  if (
    /^(WJB_SUPABASE_|SUPABASE_)/.test(name) ||
    ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"].includes(name)
  )
    delete env[name];
const id = (n) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const [A, B, WA, WB, DA, DB, SA, SB] = Array.from({ length: 8 }, (_, i) => id(i + 1));
const bytes = Buffer.from("durable fictional object"),
  hash = createHash("sha256").update(bytes).digest("hex");
const key = "durable-fixture-service-key";
const pair = await generateKeyPair("ES256");
const jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), alg: "ES256", kid: "durable-local" }] };
const sign = async (user, session) =>
  new SignJWT({ session_id: session, role: "authenticated" })
    .setSubject(user)
    .setIssuer("https://hutqsfftioxtredcjhsy.supabase.co/auth/v1")
    .setAudience("authenticated")
    .setIssuedAt(Math.floor(Date.now() / 1000))
    .setExpirationTime("1h")
    .setProtectedHeader({ alg: "ES256", kid: "durable-local", typ: "JWT" })
    .sign(pair.privateKey);
const bearer = await sign(A, SA),
  bearerB = await sign(B, SB);
const workers = new Set(),
  jobs = new Set(),
  objects = new Map();
let provider,
  providerURL,
  volumeCreated = false,
  containerCreated = false;
let faults = {},
  hooks = {};

function exec(args, input = "", timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["--host=unix:///var/run/docker.sock", ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Local command timeout"));
    }, timeout);
    child.stdout.on("data", (x) => {
      stdout += x;
      if (stdout.length > 1048576) child.kill("SIGKILL");
    });
    child.stderr.on("data", (x) => {
      stderr += x;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
async function docker(args) {
  const r = await exec(args);
  assert.equal(r.code, 0, r.stderr);
  return r.stdout;
}
async function sql(text, { role } = {}) {
  const r = await exec(
    ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres"],
    "SET standard_conforming_strings=on; SET statement_timeout='10s'; " +
      (role ? `SET ROLE ${role}; ` : "") +
      text,
  );
  if (r.code !== 0) {
    const e = new Error("Local SQL failed");
    e.code = r.stderr.match(/ERROR:\s+([A-Z][A-Z_]+)/)?.[1] || "SQL_UNAVAILABLE";
    e.detail = r.stderr;
    throw e;
  }
  return r.stdout;
}
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const literal = (value) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
const scope = (asset = 100) => ({ workspaceId: WA, assetId: id(asset), deviceId: DA, generation: "1" });
async function command(action, asset = 100, params = {}, who = { userId: A, sessionId: SA }) {
  return JSON.parse(
    await sql(
      `SELECT public.wjb_v2_asset_command(${literal({ action, ...who, scope: scope(asset), params })});`,
      { role: "service_role" },
    ),
  );
}
async function row(asset = 100) {
  return JSON.parse(
    await sql(`SELECT wjb_gateway.asset_json(a) FROM wjb_gateway.asset a WHERE id='${id(asset)}'`),
  );
}
async function used() {
  return Number(await sql(`SELECT used_bytes FROM wjb_gateway.workspace WHERE id='${WA}'`));
}
async function expire(asset = 100) {
  await sql(`UPDATE wjb_gateway.asset SET lease_expires=now()-interval '1 second' WHERE id='${id(asset)}'`);
}
async function waitReady() {
  for (let i = 0; i < 100; i++) {
    const ready = await exec(["exec", container, "pg_isready", "-U", "postgres"]);
    if (ready.code === 0) {
      const logs = await exec(["logs", container]);
      if ((logs.stdout + logs.stderr).includes("PostgreSQL init process complete")) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Local PostgreSQL not ready");
}
const reply = (res, status, value) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
};
async function requestBody(req) {
  const xs = [];
  for await (const x of req) xs.push(x);
  return Buffer.concat(xs);
}
async function providerHandler(req, res) {
  if (req.headers.authorization !== `Bearer ${key}` || req.headers.apikey !== key) return reply(res, 401, {});
  const path = new URL(req.url, "http://localhost").pathname;
  try {
    if (path === "/rest/v1/rpc/wjb_v2_session_active") {
      const args = JSON.parse((await requestBody(req)).toString());
      return reply(
        res,
        200,
        (await sql(
          `SELECT public.wjb_v2_session_active(${quote(args.p_user)}::uuid,${quote(args.p_session)}::uuid)`,
          {
            role: "service_role",
          },
        )) === "t",
      );
    }
    if (path === "/rest/v1/rpc/wjb_v2_asset_command") {
      const args = JSON.parse((await requestBody(req)).toString());
      const value = JSON.parse(
        await sql(`SELECT public.wjb_v2_asset_command(${literal(args.p_request)})`, { role: "service_role" }),
      );
      if (faults.lostReadyAck && args.p_request.action === "mark_ready") {
        faults.lostReadyAck = false;
        return reply(res, 503, { message: "private lost acknowledgement" });
      }
      return reply(res, 200, value);
    }
    const prefix = "/storage/v1/object/wjb-v2-poc-private";
    const getPrefix = "/storage/v1/object/authenticated/wjb-v2-poc-private/";
    if (req.method === "POST" && path.startsWith(prefix + "/")) {
      const object = path.slice(prefix.length + 1),
        body = await requestBody(req);
      assert.equal(req.headers["x-upsert"], "false");
      if (faults.put) return reply(res, 503, { message: "private storage detail" });
      if (objects.has(object)) return reply(res, 400, { error: "Duplicate" });
      objects.set(object, body);
      if (hooks.afterPut) await hooks.afterPut();
      return reply(res, 200, { Key: object });
    }
    if (req.method === "GET" && path.startsWith(getPrefix)) {
      const object = path.slice(getPrefix.length);
      if (!objects.has(object)) {
        if (hooks.beforeMissing) await hooks.beforeMissing();
        return reply(res, 404, {});
      }
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(objects.get(object));
      return;
    }
    if (req.method === "DELETE" && path === prefix) {
      if (faults.remove) return reply(res, 503, {});
      const data = JSON.parse((await requestBody(req)).toString());
      assert.equal(data.prefixes.length, 1);
      objects.delete(data.prefixes[0]);
      return reply(res, 200, []);
    }
    reply(res, 404, {});
  } catch (e) {
    reply(res, 400, { code: "P0001", message: e.code || "SQL_UNAVAILABLE" });
  }
}
async function startWorker(pause) {
  const child = fork(new URL("./durable-worker.mjs", import.meta.url), [], {
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const item = { child, paused: null, waiters: [] };
  workers.add(item);
  child.stdout.resume();
  child.stderr.resume();
  child.on("message", (message) => {
    if (message.type === "paused") {
      item.paused = message.phase;
      for (const r of item.waiters) r();
      item.waiters = [];
    }
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Worker readiness timeout")), 10000);
    child.on("message", (message) => {
      if (message.type === "ready") {
        clearTimeout(timer);
        item.url = `http://127.0.0.1:${message.port}`;
        resolve(item);
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Worker exited before ready"));
    });
  });
  child.send({ type: "start", config: { providerURL, key, jwks, pause } });
  return ready;
}
async function stopWorker(item, signal = "SIGTERM") {
  if (item.child.exitCode === null && item.child.signalCode === null) {
    const ended = once(item.child, "exit");
    item.child.kill(signal);
    await ended;
  }
  workers.delete(item);
}
async function paused(item) {
  if (item.paused) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Pause barrier missing")), 8000);
    item.waiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
const route = (asset = 100, action = "content") => `/v2/workspaces/${WA}/assets/${id(asset)}/${action}`;
async function request(worker, asset, action, method, data, token = bearer) {
  const headers = { authorization: `Bearer ${token}` };
  if (action === "content") {
    headers["x-wjb-device-id"] = token === bearerB ? DB : DA;
    headers["x-wjb-generation"] = "1";
    if (method === "PUT") headers["content-type"] = "application/octet-stream";
  } else headers["content-type"] = "application/json";
  return globalThis.fetch(worker.url + route(asset, action), { method, headers, body: data });
}
const reserve = (w, asset = 100) =>
  request(
    w,
    asset,
    "reserve",
    "POST",
    JSON.stringify({ deviceId: DA, generation: "1", sha256: hash, bytes: bytes.length }),
  );
const upload = (w, asset = 100) => request(w, asset, "content", "PUT", bytes);
const download = (w, asset = 100, token) => request(w, asset, "content", "GET", undefined, token);
const cancel = (w, asset = 100) =>
  request(w, asset, "cancel", "POST", JSON.stringify({ deviceId: DA, generation: "1" }));
async function error(response, code, status = 409) {
  assert.equal(response.status, status);
  const value = await response.json();
  assert.equal(value.error.code, code);
}
async function ready(w, asset = 100) {
  assert.equal((await reserve(w, asset)).status, 201);
  assert.equal((await upload(w, asset)).status, 200);
}

before(async () => {
  await docker(["volume", "create", "--label", `wjb.poc.run=${runId}`, volume]);
  assert.equal(
    await docker(["volume", "inspect", "--format", '{{index .Labels "wjb.poc.run"}}', volume]),
    runId,
  );
  volumeCreated = true;
  await docker([
    "run",
    "-d",
    "--name",
    container,
    "--label",
    `wjb.poc.run=${runId}`,
    "--network",
    "none",
    "--memory",
    "512m",
    "--cpus",
    "1",
    "--pids-limit",
    "128",
    "--mount",
    `type=volume,source=${volume},destination=/var/lib/postgresql/data`,
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    image,
    "-c",
    "listen_addresses=",
  ]);
  containerCreated = true;
  await waitReady();
  await sql(`CREATE ROLE service_role NOLOGIN NOSUPERUSER NOBYPASSRLS;CREATE ROLE authenticated NOLOGIN;CREATE ROLE anon NOLOGIN;
    CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,banned_until timestamptz,deleted_at timestamptz);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),not_after timestamptz);`);
  await sql(readFileSync(new URL("../v2-cloud/session-guard.sql", import.meta.url), "utf8"));
  await sql(readFileSync(new URL("./postgres-metadata.sql", import.meta.url), "utf8"));
  process.stdout.write("# PostgreSQL " + (await sql("SHOW server_version")) + "\n");
  provider = createServer((req, res) => {
    const job = providerHandler(req, res);
    jobs.add(job);
    job.finally(() => jobs.delete(job));
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  providerURL = `http://127.0.0.1:${provider.address().port}`;
});
beforeEach(async () => {
  for (const w of [...workers]) await stopWorker(w);
  await Promise.allSettled([...jobs]);
  objects.clear();
  faults = {};
  hooks = {};
  await sql(`TRUNCATE wjb_gateway.io_intent,wjb_gateway.asset,wjb_gateway.device,wjb_gateway.workspace,wjb_v2_cloud.blocked_session,auth.sessions,auth.users;
    INSERT INTO auth.users(id)VALUES('${A}'),('${B}');INSERT INTO auth.sessions(id,user_id)VALUES('${SA}','${A}'),('${SB}','${B}');
    INSERT INTO wjb_gateway.workspace(id,owner_id,generation)VALUES('${WA}','${A}',1),('${WB}','${B}',1);
    INSERT INTO wjb_gateway.device(id,user_id,session_id)VALUES('${DA}','${A}','${SA}'),('${DB}','${B}','${SB}');`);
});
after(async () => {
  for (const w of [...workers]) await stopWorker(w, "SIGKILL");
  if (provider) {
    provider.closeAllConnections();
    await new Promise((r) => provider.close(r));
  }
  if (containerCreated) {
    assert.equal(
      await docker(["inspect", "--format", '{{index .Config.Labels "wjb.poc.run"}}', container]),
      runId,
    );
    await docker(["rm", "-f", container]);
  }
  if (volumeCreated) {
    assert.equal(
      await docker(["volume", "inspect", "--format", '{{index .Labels "wjb.poc.run"}}', volume]),
      runId,
    );
    await docker(["volume", "rm", volume]);
  }
});

test("HTTP gateway to real SQL and Storage fixture round trip", async () => {
  const w = await startWorker();
  await ready(w);
  const r = await download(w);
  assert.equal(r.status, 200);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes);
  assert.equal(await used(), bytes.length);
});
test("gateway SIGKILL and restart preserves committed ready bytes", async () => {
  let w = await startWorker();
  await ready(w);
  await stopWorker(w, "SIGKILL");
  w = await startWorker();
  assert.equal((await download(w)).status, 200);
  assert.equal(await used(), bytes.length);
});
test("reservation retry after gateway restart charges quota once", async () => {
  let w = await startWorker();
  assert.equal((await reserve(w)).status, 201);
  await stopWorker(w, "SIGKILL");
  w = await startWorker();
  assert.equal((await reserve(w)).status, 200);
  assert.equal(await used(), bytes.length);
});
test("PostgreSQL container restart preserves metadata and quota", async () => {
  const w = await startWorker();
  await ready(w);
  await docker(["restart", container]);
  await waitReady();
  assert.equal((await download(w)).status, 200);
  assert.equal(await used(), bytes.length);
});
test("two gateway processes cannot hold one write lease", async () => {
  const a = await startWorker("after-put"),
    b = await startWorker();
  await reserve(a);
  const first = upload(a);
  await paused(a);
  await error(await upload(b), "LEASE_BUSY");
  a.child.send({ type: "resume" });
  assert.equal((await first).status, 200);
  assert.equal(objects.size, 1);
});
test("expired old worker cannot publish or erase new lease", async () => {
  const a = await startWorker("after-put"),
    b = await startWorker();
  await reserve(a);
  const first = upload(a);
  await paused(a);
  await expire();
  assert.equal((await upload(b)).status, 200);
  a.child.send({ type: "resume" });
  await error(await first, "LEASE_LOST");
  assert.equal((await row()).state, "ready");
  assert.equal((await download(b)).status, 200);
});
test("late write after cleanup does not release quota prematurely", async () => {
  const a = await startWorker("before-put"),
    b = await startWorker();
  await reserve(a);
  const first = upload(a);
  await paused(a);
  await expire();
  await error(await cancel(b), "CLEANUP_UNCERTAIN");
  assert.equal(await used(), bytes.length);
  a.child.send({ type: "resume" });
  await error(await first, "LEASE_LOST");
  assert.equal(objects.size, 1);
  assert.equal((await cancel(b)).status, 200);
  assert.equal(objects.size, 0);
  assert.equal(await used(), 0);
});
test("SIGKILL after object put recovers via immutable retry", async () => {
  const a = await startWorker("after-put");
  await reserve(a);
  const pending = upload(a).catch(() => null);
  await paused(a);
  await stopWorker(a, "SIGKILL");
  await pending;
  assert.equal((await row()).state, "reserved");
  assert.equal(objects.size, 1);
  await expire();
  const b = await startWorker();
  assert.equal((await upload(b)).status, 200);
  assert.equal((await row()).state, "ready");
  assert.equal(await used(), bytes.length);
});
test("SIGKILL after intent before put preserves conservative accounting", async () => {
  const a = await startWorker("before-put");
  await reserve(a);
  const pending = upload(a).catch(() => null);
  await paused(a);
  await stopWorker(a, "SIGKILL");
  await pending;
  assert.equal(objects.size, 0);
  await expire();
  const b = await startWorker();
  await error(await cancel(b), "CLEANUP_UNCERTAIN");
  assert.equal((await row()).state, "cleanup");
  assert.equal(await used(), bytes.length);
});
test("provider logout during upload prevents SQL ready publication", async () => {
  const w = await startWorker();
  await reserve(w);
  hooks.afterPut = () => sql(`DELETE FROM auth.sessions WHERE id='${SA}'`);
  await error(await upload(w), "ACCESS_REVOKED", 403);
  assert.equal((await row()).state, "reserved");
});
test("metadata transaction failure retains private bytes and can retry", async () => {
  const w = await startWorker();
  await reserve(w);
  await sql(
    "CREATE FUNCTION wjb_gateway.inject_failure()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'PRIVATE_FAILURE';END$$;CREATE TRIGGER inject_ready BEFORE UPDATE ON wjb_gateway.asset FOR EACH ROW WHEN(NEW.state='ready')EXECUTE FUNCTION wjb_gateway.inject_failure();",
  );
  try {
    await error(await upload(w), "METADATA_UNAVAILABLE", 503);
    assert.equal((await row()).state, "reserved");
    assert.equal(objects.size, 1);
  } finally {
    await sql("DROP TRIGGER inject_ready ON wjb_gateway.asset;DROP FUNCTION wjb_gateway.inject_failure()");
  }
  assert.equal((await upload(w)).status, 200);
});
test("lost committed ready RPC response replays without duplicate write", async () => {
  const w = await startWorker();
  await reserve(w);
  faults.lostReadyAck = true;
  await error(await upload(w), "METADATA_UNAVAILABLE", 503);
  assert.equal((await row()).state, "ready");
  assert.equal((await upload(w)).status, 200);
  assert.equal(objects.size, 1);
});
test("delete failure persists cleanup across process restart", async () => {
  let w = await startWorker();
  await reserve(w);
  faults.remove = true;
  await error(await cancel(w), "STORAGE_UNAVAILABLE", 503);
  assert.equal((await row()).state, "cleanup");
  await stopWorker(w, "SIGKILL");
  w = await startWorker();
  faults.remove = false;
  assert.equal((await cancel(w)).status, 200);
  assert.equal(await used(), 0);
});
test("unknown upload outcome cannot be canceled by guessing absence", async () => {
  const w = await startWorker();
  await reserve(w);
  faults.put = true;
  await error(await upload(w), "STORAGE_UNAVAILABLE", 503);
  faults.put = false;
  await error(await cancel(w), "CLEANUP_UNCERTAIN");
  assert.equal(objects.size, 0);
  assert.equal(await used(), bytes.length);
});
test("generation change during I/O blocks final SQL mutation", async () => {
  const w = await startWorker();
  await reserve(w);
  hooks.afterPut = () => sql(`UPDATE wjb_gateway.workspace SET generation=2 WHERE id='${WA}'`);
  await error(await upload(w), "GENERATION_CHANGED");
  assert.equal((await row()).state, "reserved");
});
test("another account cannot read private asset through SQL", async () => {
  const w = await startWorker();
  await ready(w);
  await error(await download(w, 100, bearerB), "ACCESS_DENIED", 403);
});
test("separate processes reserve quota atomically", async () => {
  await sql(`UPDATE wjb_gateway.workspace SET quota_bytes=${bytes.length} WHERE id='${WA}'`);
  const a = await startWorker(),
    b = await startWorker();
  const rs = await Promise.all([reserve(a, 100), reserve(b, 101)]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await used(), bytes.length);
});
test("client roles cannot execute metadata command or read tables", async () => {
  await assert.rejects(() =>
    sql("SELECT public.wjb_v2_asset_command('{}'::jsonb)", { role: "authenticated" }),
  );
  await assert.rejects(() => sql("SELECT * FROM wjb_gateway.asset", { role: "service_role" }));
});
test("SQL cannot publish ready without settled storage intent", async () => {
  await command("reserve", 100, { sha256: hash, bytes: bytes.length });
  const token = randomUUID();
  const r = await command("acquire", 100, { token, mode: "write" });
  await assert.rejects(
    () => command("mark_ready", 100, { token, fence: r.fence }),
    (e) => e.code === "STORAGE_NOT_CONFIRMED",
  );
});
test("stale lease release never clears newer owner", async () => {
  await command("reserve", 100, { sha256: hash, bytes: bytes.length });
  const old = randomUUID(),
    next = randomUUID();
  const a = await command("acquire", 100, { token: old, mode: "write" });
  await expire();
  const b = await command("acquire", 100, { token: next, mode: "write" });
  await command("release", 100, { token: old, fence: a.fence });
  const check = await command("recheck", 100, { token: next, fence: b.fence });
  assert.equal(check.leaseToken, next);
});
test("cleanup epoch detects settlement after absence observation", async () => {
  await command("reserve", 100, { sha256: hash, bytes: bytes.length });
  const old = randomUUID(),
    next = randomUUID(),
    intent = randomUUID();
  const a = await command("acquire", 100, { token: old, mode: "write" });
  await command("begin_io", 100, { token: old, fence: a.fence, intent });
  await expire();
  const b = await command("acquire", 100, { token: next, mode: "cancel" });
  const snapshot = await command("mark_cleanup", 100, { token: next, fence: b.fence });
  await command("settle_io", 100, { token: old, fence: a.fence, intent });
  await assert.rejects(
    () => command("mark_canceled", 100, { token: next, fence: b.fence, ioVersion: snapshot.ioVersion }),
    (e) => e.code === "CLEANUP_CHANGED",
  );
  assert.equal(await used(), bytes.length);
});
test("canceled asset survives restart and cannot be reused", async () => {
  let w = await startWorker();
  await reserve(w);
  assert.equal((await cancel(w)).status, 200);
  await stopWorker(w, "SIGKILL");
  w = await startWorker();
  await error(await reserve(w), "ASSET_CANCELED");
  assert.equal(await used(), 0);
});
test("reserve insertion failure rolls quota increment back", async () => {
  const w = await startWorker();
  await sql(
    "CREATE FUNCTION wjb_gateway.inject_failure()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'PRIVATE_FAILURE';END$$;CREATE TRIGGER inject_reserve BEFORE INSERT ON wjb_gateway.asset FOR EACH ROW EXECUTE FUNCTION wjb_gateway.inject_failure();",
  );
  try {
    await error(await reserve(w), "METADATA_UNAVAILABLE", 503);
    assert.equal(await used(), 0);
  } finally {
    await sql("DROP TRIGGER inject_reserve ON wjb_gateway.asset;DROP FUNCTION wjb_gateway.inject_failure()");
  }
  assert.equal((await reserve(w)).status, 201);
});

test("asset registry limit also counts canceled identifiers", async () => {
  await sql(
    `INSERT INTO wjb_gateway.asset(workspace_id,id,generation,device_id,sha256,bytes,state,expires_at) SELECT '${WA}',md5(n::text)::uuid,1,'${DA}',repeat('0',64),1,'canceled',now() FROM generate_series(1,256) n`,
  );
  const w = await startWorker();
  await error(await reserve(w), "ASSET_LIMIT");
  assert.equal(await used(), 0);
});

test("partial lease tuple is rejected atomically by schema", async () => {
  await command("reserve", 100, { sha256: hash, bytes: bytes.length });
  await assert.rejects(() =>
    sql(
      `UPDATE wjb_gateway.asset SET lease_token='${id(999)}',lease_expires=now()+interval '1 minute',lease_mode=NULL WHERE id='${id(100)}'`,
    ),
  );
  assert.equal((await row()).leaseToken, null);
  assert.equal(await used(), bytes.length);
});
