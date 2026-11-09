// Explicit DEV integration probe; not imported by the app or a deployment.
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createDevelopmentGateway } from "../../v2-gateway/development-gateway.mjs";
import { createNodeServer } from "../../v2-gateway/node-server.mjs";
import { createVerifier } from "../../v2-auth/verifier.mjs";

const ref = "vsphftnmfzfoufasjttd",
  bucket = "wjb-v2-poc-private";
if (
  process.argv.slice(2).join(" ") !== "--run-development-fixtures --free-usage-confirmed" ||
  process.env.WJB_CLOUD_ENV !== "development" ||
  process.env.WJB_SUPABASE_DEV_PROJECT_REF !== ref
)
  throw new Error("Explicit DEV fixture and observed Free/Usage confirmation required");
const key = process.env.WJB_SUPABASE_DEV_SERVICE_ROLE_KEY;
const management = process.env.WJB_SUPABASE_DEV_MANAGEMENT_TOKEN;
if (!key || !management) throw new Error("Configured DEV credentials required");
const origin = `https://${ref}.supabase.co`;
const report = {
  target: ref,
  startedAt: new Date().toISOString(),
  checks: [],
  cleanup: {},
  outboundRequests: 0,
  outboundBodyBytes: 0,
  storageWriteRequests: 0,
  mailSent: false,
  productionTouched: false,
  publicGatewayDeployed: false,
};
const workspace = randomUUID(),
  devices = [randomUUID(), randomUUID()],
  users = [],
  sessions = [],
  tokens = [];
const attemptedUsers = [],
  trackedPaths = new Set();
let createdBucket = false,
  attemptedBucket = false,
  server,
  local,
  injectLostResponse = false,
  injectFinalizeFailure = false;
const hash = (b) => createHash("sha256").update(b).digest("hex");
function check(name, passed, details = {}) {
  report.checks.push({ name, passed: Boolean(passed), ...details });
  console.log(JSON.stringify({ check: name, passed: Boolean(passed) }));
  if (!passed) throw new Error(name);
}
// No redirects, bounded requests, inherited Cloud proxy/CA via --use-env-proxy.
async function outbound(url, options = {}, cleanup = false) {
  const target = new URL(url);
  if (![origin, "https://api.supabase.com"].includes(target.origin)) throw new Error("Unexpected origin");
  if (
    target.origin === "https://api.supabase.com" &&
    target.pathname !== `/v1/projects/${ref}/database/query`
  )
    throw new Error("Unexpected management path");
  report.outboundRequests++;
  if (!cleanup && report.outboundRequests > 350) throw new Error("Request budget exceeded");
  const size = options.body ? Buffer.byteLength(options.body) : 0;
  report.outboundBodyBytes += size;
  if (target.pathname.startsWith(`/storage/v1/object/${bucket}/`) && options.method === "POST") {
    report.storageWriteRequests++;
    if (report.storageWriteRequests > 12 || size > 65536) throw new Error("Storage write budget exceeded");
  }
  return fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(15000) });
}
async function api(path, { method = "GET", data, access, serverKey = true, cleanup = false } = {}) {
  const headers = { apikey: key, "content-type": "application/json" };
  if (access || serverKey) headers.authorization = `Bearer ${access || key}`;
  const r = await outbound(
    origin + path,
    { method, headers, ...(data === undefined ? {} : { body: JSON.stringify(data) }) },
    cleanup,
  );
  const raw = await r.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  return { status: r.status, body };
}
async function sql(query, cleanup = false) {
  const r = await outbound(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${management}`, "content-type": "application/json" },
      body: JSON.stringify({ query, read_only: false }),
    },
    cleanup,
  );
  if (!r.ok) {
    await r.body?.cancel();
    throw new Error("Management query failed");
  }
  return r.json();
}
async function gateway(assetId, action, { index = 0, method = "GET", data, bytes, auth = true } = {}) {
  const headers = { "x-wjb-device-id": devices[index], "x-wjb-generation": "1" };
  if (auth) headers.authorization = `Bearer ${tokens[index]}`;
  if (data) headers["content-type"] = "application/json";
  if (bytes) headers["content-type"] = "application/octet-stream";
  return fetch(`${local}/v2/workspaces/${workspace}/assets/${assetId}/${action}`, {
    method,
    headers,
    ...(data ? { body: JSON.stringify(data) } : bytes ? { body: bytes } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
}
async function reserve(assetId, bytes, index = 0) {
  return gateway(assetId, "reserve", {
    index,
    method: "POST",
    data: {
      deviceId: devices[index],
      generation: "1",
      bytes: bytes.length,
      sha256: hash(bytes),
    },
  });
}
try {
  const current = await api("/storage/v1/bucket");
  check(
    "bucket_preflight_no_collision",
    current.status === 200 && Array.isArray(current.body) && !current.body.some((x) => x.id === bucket),
  );
  const jwksResponse = await api("/auth/v1/.well-known/jwks.json", { serverKey: false });
  check("trusted_dev_jwks", jwksResponse.status === 200);
  for (let index = 0; index < 2; index++) {
    const id = randomUUID(),
      email = `wjb-v2-${id}@example.invalid`,
      password = randomBytes(32).toString("base64url");
    attemptedUsers.push(id);
    const created = await api("/auth/v1/admin/users", {
      method: "POST",
      data: {
        id,
        email,
        password,
        email_confirm: true,
        user_metadata: { fixture: "wjb-v2-development-storage-probe" },
      },
    });
    check(`confirmed_fixture_${index}`, [200, 201].includes(created.status) && created.body?.id === id);
    users.push(id);
    const login = await api("/auth/v1/token?grant_type=password", {
      method: "POST",
      serverKey: false,
      data: { email, password },
    });
    check(`login_${index}`, login.status === 200 && typeof login.body?.access_token === "string");
    tokens.push(login.body.access_token);
    const verify = createVerifier({
      projectRef: ref,
      jwks: jwksResponse.body,
      sessionIsActive: async () => true,
    });
    const principal = await verify(tokens[index]);
    check(`verified_subject_${index}`, principal.userId === id);
    sessions.push(principal.sessionId);
  }
  attemptedBucket = true;
  const creation = await api("/storage/v1/bucket", {
    method: "POST",
    data: {
      id: bucket,
      name: bucket,
      public: false,
      file_size_limit: 65536,
      allowed_mime_types: ["application/octet-stream"],
    },
  });
  createdBucket = [200, 201].includes(creation.status);
  check("private_bucket_created", createdBucket);
  const config = await api(`/storage/v1/bucket/${bucket}`);
  check(
    "private_bucket_limits",
    config.status === 200 &&
      config.body?.public === false &&
      Number(config.body.file_size_limit) === 65536 &&
      config.body.allowed_mime_types?.includes("application/octet-stream"),
  );
  await sql(
    `BEGIN; INSERT INTO wjb_gateway.workspace(id,owner_id,generation) VALUES ('${workspace}','${users[0]}',1);` +
      devices
        .map(
          (d, i) =>
            `INSERT INTO wjb_gateway.device(id,user_id,session_id) VALUES ('${d}','${users[i]}','${sessions[i]}');`,
        )
        .join("") +
      "COMMIT;",
  );
  const transport = async (url, options) => {
    if (
      injectFinalizeFailure &&
      url.pathname.endsWith("wjb_v2_asset_command") &&
      JSON.parse(options.body).p_request?.action === "mark_ready"
    ) {
      injectFinalizeFailure = false;
      return Response.json({ error: "Injected publication failure" }, { status: 503 });
    }
    const r = await outbound(url, options);
    if (
      injectLostResponse &&
      url.pathname.startsWith(`/storage/v1/object/${bucket}/`) &&
      options.method === "POST" &&
      r.ok
    ) {
      injectLostResponse = false;
      await r.body?.cancel();
      throw new Error("Injected response loss after storage success");
    }
    return r;
  };
  const composed = createDevelopmentGateway({
    projectRef: ref,
    serviceRoleKey: key,
    jwks: jwksResponse.body,
    fetchTransport: transport,
  });
  server = createNodeServer(composed.handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  local = `http://127.0.0.1:${server.address().port}`;
  const samples = [
    [
      "png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
        "base64",
      ),
    ],
    ["webp", Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64")],
    ["utf8", Buffer.from("가상 업무 메모 — Supabase private storage probe\n", "utf8")],
  ];
  check(
    "fixture_size_budget",
    samples.every(([, b]) => b.length <= 65536) && samples.reduce((n, [, b]) => n + b.length, 0) <= 196608,
  );
  for (const [type, bytes] of samples) {
    const id = randomUUID();
    trackedPaths.add(`${workspace}/${id}`);
    const reserved = await reserve(id, bytes);
    check(`${type}_reserve`, reserved.status === 201);
    await reserved.body?.cancel();
    if (type === "png") {
      const denied = await gateway(id, "content", { auth: false });
      check("gateway_no_auth_denied", denied.status === 401);
      await denied.body?.cancel();
      const wrong = await gateway(id, "content", { method: "PUT", bytes: Buffer.alloc(bytes.length, 1) });
      check("wrong_hash_denied", wrong.status === 409);
      await wrong.body?.cancel();
      injectLostResponse = true;
      const lost = await gateway(id, "content", { method: "PUT", bytes });
      check("lost_storage_response_is_failure", lost.status === 503);
      await lost.body?.cancel();
    }
    if (type === "utf8") {
      injectFinalizeFailure = true;
      const interrupted = await gateway(id, "content", { method: "PUT", bytes });
      check("publication_failure_leaves_pending", interrupted.status === 503);
      await interrupted.body?.cancel();
      const scope = { workspaceId: workspace, deviceId: devices[0], generation: "1" };
      const preview = await composed.recovery.preview({ token: tokens[0], scope });
      const plan = preview.plans.find((p) => p.scope.assetId === id);
      check(
        "actual_recovery_preview",
        plan?.status === "RECOVERABLE" && plan.actions.includes("RESTORE_READY"),
      );
      const restored = await composed.recovery.apply({
        token: tokens[0],
        plan,
        reviewHash: plan.reviewHash,
        action: "RESTORE_READY",
      });
      check("actual_recovery_restore", restored.state === "ready");
    }
    const uploaded = await gateway(id, "content", { method: "PUT", bytes });
    check(`${type}_upload`, uploaded.status === 200, { bytes: bytes.length });
    await uploaded.body?.cancel();
    const retry = await gateway(id, "content", { method: "PUT", bytes });
    check(`${type}_idempotent_retry`, retry.status === 200);
    await retry.body?.cancel();
    const read = await gateway(id, "content");
    const received = Buffer.from(await read.arrayBuffer());
    check(
      `${type}_read_hash_bytes`,
      read.status === 200 && received.equals(bytes) && hash(received) === hash(bytes),
    );
    const other = await gateway(id, "content", { index: 1 });
    check(`${type}_other_owner_denied`, other.status === 403);
    await other.body?.cancel();
    const direct = await outbound(`${origin}/storage/v1/object/authenticated/${bucket}/${workspace}/${id}`, {
      headers: { apikey: key, authorization: `Bearer ${tokens[0]}` },
    });
    check(`${type}_authenticated_direct_denied`, !direct.ok);
    await direct.body?.cancel();
    const publicRead = await outbound(`${origin}/storage/v1/object/public/${bucket}/${workspace}/${id}`);
    check(`${type}_public_read_denied`, !publicRead.ok);
    await publicRead.body?.cancel();
  }
  const counts = await sql(`SELECT count(*) AS objects FROM storage.objects WHERE bucket_id='${bucket}';`);
  check("three_physical_objects_despite_retries", Number(counts[0]?.objects) === 3);
  // Cancellation is for a pending object, not deletion of a ready user asset.
  const canceledId = randomUUID(),
    pending = Buffer.from("pending fixture");
  trackedPaths.add(`${workspace}/${canceledId}`);
  const pendingReserve = await reserve(canceledId, pending);
  check("pending_reserve", pendingReserve.status === 201);
  await pendingReserve.body?.cancel();
  const cancel = await gateway(canceledId, "cancel", {
    method: "POST",
    data: { deviceId: devices[0], generation: "1" },
  });
  const cancelBody = await cancel.json();
  check("pending_cancel_absence_confirmed", cancel.status === 200 && cancelBody.state === "canceled", {
    http: cancel.status,
    code: cancelBody.error?.code,
  });
  const [before] = await sql(`SELECT used_bytes FROM wjb_gateway.workspace WHERE id='${workspace}';`);
  await sql(`UPDATE wjb_gateway.workspace SET quota_bytes=used_bytes+100 WHERE id='${workspace}';`);
  const concurrentIds = [randomUUID(), randomUUID()];
  concurrentIds.forEach((id) => trackedPaths.add(`${workspace}/${id}`));
  const concurrent = await Promise.all(concurrentIds.map((id) => reserve(id, Buffer.alloc(80))));
  const statuses = concurrent.map((r) => r.status).sort();
  const results = await Promise.all(concurrent.map((r) => r.json()));
  check(
    "concurrent_reservations_respect_quota",
    statuses.join(",") === "201,409" && results.some((r) => r.error?.code === "QUOTA_EXCEEDED"),
  );
  const winner = concurrentIds[concurrent.findIndex((r) => r.status === 201)];
  const canceledQuota = await gateway(winner, "cancel", {
    method: "POST",
    data: { deviceId: devices[0], generation: "1" },
  });
  check("quota_reservation_cancel", canceledQuota.status === 200);
  await canceledQuota.body?.cancel();
  const [after] = await sql(
    `SELECT used_bytes,quota_bytes FROM wjb_gateway.workspace WHERE id='${workspace}';`,
  );
  check(
    "quota_restored_after_confirmed_absence",
    Number(after.used_bytes) === Number(before.used_bytes) &&
      Number(after.used_bytes) <= Number(after.quota_bytes),
  );
  const tooLarge = await reserve(randomUUID(), Buffer.alloc(65537));
  check("over_64k_reservation_denied", tooLarge.status === 400);
  await tooLarge.body?.cancel();
  const revoke = await api("/rest/v1/rpc/wjb_v2_revoke_session", {
    method: "POST",
    data: { p_user: users[0], p_session: sessions[0] },
  });
  check("session_revocation", [200, 204].includes(revoke.status));
  const firstId = [...trackedPaths][0].split("/")[1];
  const revoked = await gateway(firstId, "content");
  check("revoked_session_cannot_download", revoked.status === 403);
  await revoked.body?.cancel();
} catch (error) {
  report.failureType = error.name; // no upstream payloads, credentials or JWTs in logs
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (createdBucket) {
    try {
      const removed = await api(`/storage/v1/object/${bucket}`, {
        method: "DELETE",
        data: { prefixes: [...trackedPaths] },
        cleanup: true,
      });
      if (![200, 204].includes(removed.status)) throw new Error("Object cleanup failed");
      const remaining = await sql(
        `SELECT count(*) AS objects FROM storage.objects WHERE bucket_id='${bucket}';`,
        true,
      );
      report.cleanup.objectsAbsent = Number(remaining[0]?.objects) === 0;
      if (report.cleanup.objectsAbsent)
        await api(`/storage/v1/bucket/${bucket}`, { method: "DELETE", cleanup: true });
      const current = await api("/storage/v1/bucket", { cleanup: true });
      report.cleanup.bucketAbsent =
        current.status === 200 && Array.isArray(current.body) && !current.body.some((x) => x.id === bucket);
    } catch {
      report.cleanup.objectsAbsent = false;
      report.cleanup.bucketAbsent = false;
    }
  } else if (attemptedBucket) report.cleanup.bucketCreationUnconfirmed = false;
  try {
    const ids = attemptedUsers.map((x) => `'${x}'`).join(",") || "NULL";
    await sql(
      `BEGIN; DELETE FROM wjb_gateway.recovery_audit WHERE workspace_id='${workspace}';
      DELETE FROM wjb_gateway.io_intent WHERE workspace_id='${workspace}';
      DELETE FROM wjb_gateway.asset WHERE workspace_id='${workspace}';
      DELETE FROM wjb_gateway.workspace WHERE id='${workspace}';
      DELETE FROM wjb_gateway.device WHERE id IN ('${devices.join("','")}');
      DELETE FROM wjb_v2_cloud.blocked_session WHERE user_id IN (${ids}); COMMIT;`,
      true,
    );
    const rows = await sql(
      `SELECT
      (SELECT count(*) FROM wjb_gateway.workspace WHERE id='${workspace}') +
      (SELECT count(*) FROM wjb_gateway.asset WHERE workspace_id='${workspace}') +
      (SELECT count(*) FROM wjb_gateway.io_intent WHERE workspace_id='${workspace}') +
      (SELECT count(*) FROM wjb_gateway.recovery_audit WHERE workspace_id='${workspace}') +
      (SELECT count(*) FROM wjb_gateway.device WHERE id IN ('${devices.join("','")}')) +
      (SELECT count(*) FROM wjb_v2_cloud.blocked_session WHERE user_id IN (${ids})) AS remaining;`,
      true,
    );
    report.cleanup.metadataAbsent = Number(rows[0]?.remaining) === 0;
  } catch {
    report.cleanup.metadataAbsent = false;
  }
  const absent = [];
  for (const id of attemptedUsers) {
    try {
      await api(`/auth/v1/admin/users/${id}`, { method: "DELETE", cleanup: true });
      absent.push((await api(`/auth/v1/admin/users/${id}`, { cleanup: true })).status === 404);
    } catch {
      absent.push(false);
    }
  }
  report.cleanup.authUsersAbsent = absent.every(Boolean);
  if (!Object.values(report.cleanup).every(Boolean))
    report.cleanupIdentifiers = {
      users: attemptedUsers,
      workspace,
      devices,
      bucket: attemptedBucket ? bucket : null,
    };
  report.passed = !report.failureType && Object.values(report.cleanup).every(Boolean);
  report.finishedAt = new Date().toISOString();
  await writeFile(
    new URL("../../../docs/v2-design/evidence/development-storage-live-check.json", import.meta.url),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
}
