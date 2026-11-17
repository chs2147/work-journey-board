// 개발 프로젝트 전용 실서버 시험(C-1b, docs/v2-design/82): 앱처럼 **HTTP(Edge gateway)만** 써서
// 로그인 → 기기 등록 → 5,000행 넘는 일지 페이지 업로드 → 5MB 그림 업로드·서버 확인 → 게시 → 다시 읽기,
// 다른 작업은 취소 → 정리 확인. 끝나면 시험 계정·자료·객체를 모두 지우고 잔여 0을 확인한다.
// 서버 열쇠·관리 토큰은 시험 준비(가상 계정·인증번호)와 정리에만 쓰고 gateway 요청에는 사용자 토큰만.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const ref = "vsphftnmfzfoufasjttd";
if (
  process.argv.slice(2).join(" ") !== "--run-development" ||
  process.env.WJB_CLOUD_ENV !== "development" ||
  process.env.WJB_SUPABASE_DEV_PROJECT_REF !== ref
)
  throw Error("EXPLICIT_DEV_RUN_REQUIRED");
const key = process.env.WJB_SUPABASE_DEV_SERVICE_ROLE_KEY,
  mgmt = process.env.WJB_SUPABASE_DEV_MANAGEMENT_TOKEN;
if (!key || !mgmt) throw Error("DEV_CREDENTIALS_REQUIRED");
const origin = `https://${ref}.supabase.co`,
  gw = `${origin}/functions/v1/wjb-gateway`,
  bucket = "wjb-v2-dev-assets";
const publishable = /publishable_key: Some\("([^"]+)"\)/.exec(
  readFileSync(new URL("../../../src-tauri/src/online.rs", import.meta.url), "utf8"),
)[1];
const sha = (b) => createHash("sha256").update(b).digest("hex");
const checks = [];
const check = (name, ok, extra) => {
  checks.push({ name, passed: !!ok, ...(extra ? { extra } : {}) });
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? " " + JSON.stringify(extra) : ""));
};
const admin = async (method, path, body) => {
  const r = await fetch(origin + path, {
    method,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${mgmt}`, "content-type": "application/json" },
    body: JSON.stringify({ query, read_only: false }),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error("DEV_SQL_" + r.status);
  return r.json();
};
let token = null;
const deviceId = randomUUID();
const post = async (path, body, { raw, headers = {} } = {}) => {
  const r = await fetch(gw + path, {
    method: raw ? "PUT" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": raw ? "application/octet-stream" : "application/json",
      ...headers,
    },
    body: raw ?? JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(150000),
  });
  const value = await r.json().catch(() => null);
  return { status: r.status, value };
};
const mig = async (jobId, action, params) => {
  const r = await post(`/v2/migrations/${jobId}/${action}`, { deviceId, params });
  if (r.status !== 200)
    throw Object.assign(Error(`HTTP_${action}_${r.status}_${r.value?.error ?? ""}`), { r });
  return r.value;
};

function envelope() {
  const out = execFileSync(
    "node",
    [
      new URL("../../v2-migration/emit-workspace-fixture.mjs", import.meta.url).pathname,
      "20",
      "--extra-items",
      "5000",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 },
  );
  const m = JSON.parse(out);
  // 그림 바이트는 가상(무작위)으로 만들고 봉투의 해시·크기·참조를 맞춘다. 첫 그림 = 5MB
  const blobs = new Map();
  m.assets.forEach((a, i) => {
    const bytes = randomBytes(
      i === 0 ? Number(process.env.WJB_LIVE_FIRST_ASSET_BYTES || 5 * 1024 * 1024) : 2048,
    );
    const next = { objectId: a.objectId, sha256: sha(bytes), bytes: bytes.length };
    blobs.set(a.objectId, bytes);
    for (const r of m.records)
      if (["note_asset", "cabi_asset"].includes(r.table))
        for (const f of ["dataRef", "thumbRef"])
          if (r.value[f]?.objectId === a.objectId) {
            r.value[f] = { ...next };
            if (f === "dataRef") r.value.bytes = next.bytes;
          }
    Object.assign(a, next);
  });
  return { m, blobs };
}

const created = { users: [], workspaces: [], jobs: [], devices: [] };
const report = {
  startedAt: new Date().toISOString(),
  projectRef: ref,
  productionTouched: false,
  mailSent: false,
  transport: "edge-gateway-http-only",
  checks,
  timing: {},
};
try {
  // 1) 가상 계정(메일 없음) → 인증번호 → 사용자 토큰
  const email = `wjb-copy-${randomUUID()}@example.invalid`;
  const u = await admin("POST", "/auth/v1/admin/users", { email, email_confirm: true });
  if (u.status !== 200) throw Error("CREATE_USER_" + u.status);
  created.users.push(u.body.id);
  const link = await admin("POST", "/auth/v1/admin/generate_link", { type: "magiclink", email });
  const otp = link.body?.email_otp ?? link.body?.properties?.email_otp;
  const v = await fetch(`${origin}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: publishable, "content-type": "application/json" },
    body: JSON.stringify({ type: "email", email, token: otp }),
  });
  token = (await v.json()).access_token;
  check("login_with_code", v.status === 200 && !!token);
  // G-4: gateway가 새 비밀 키(wjb_gateway)로 돌고 있다(값은 내보내지 않고 종류만)
  const me = await fetch(`${gw}/v2/me`, { headers: { authorization: `Bearer ${token}` } });
  const meBody = await me.json().catch(() => null);
  check("gateway_uses_new_secret_key", me.status === 200 && meBody?.serverKey === "secret", {
    serverKey: meBody?.serverKey ?? null,
    project: meBody?.project ?? null,
  });
  // 2) 기기 등록(같은 기기 다시 = 그대로)
  const d1 = await post("/v2/devices", { deviceId });
  const d2 = await post("/v2/devices", { deviceId });
  check("device_registered", d1.status === 200 && d2.status === 200 && d1.value.registered === true);

  // 3) 큰 일지 페이지 업로드
  const { m, blobs } = envelope();
  created.workspaces.push(m.workspaceId);
  const job = randomUUID();
  created.jobs.push(job);
  const header = Object.fromEntries(Object.entries(m).filter(([k]) => k !== "records"));
  const pages = [];
  for (let i = 0; i < m.records.length; i += 1000) pages.push(m.records.slice(i, i + 1000));
  let t = Date.now();
  await mig(job, "upload_begin", { header, pages: pages.length, records: m.records.length });
  for (let i = 0; i < pages.length; i++) {
    if (i === 3) continue; // 끊긴 상황
    await mig(job, "upload_page", { index: i, records: pages[i] });
  }
  const st = await mig(job, "upload_status", {});
  check("resume_reports_missing_page", JSON.stringify(st.received) === JSON.stringify([0, 1, 2, 4, 5]), {
    received: st.received,
  });
  await mig(job, "upload_page", { index: 3, records: pages[3] });
  const started = await mig(job, "start_upload", {});
  report.timing.recordsSeconds = (Date.now() - t) / 1000;
  check("paged_upload_started", started.state === "staging" && m.records.length > 5000, {
    records: m.records.length,
    pages: pages.length,
  });
  const mh = started.manifestHash;

  // 4) 그림 업로드(기존 gateway 경로) → 서버가 바이트를 다시 읽어 확인(attest)
  t = Date.now();
  for (const a of m.assets) {
    const r = await post(`/v2/workspaces/${m.workspaceId}/assets/${a.objectId}/content`, null, {
      raw: blobs.get(a.objectId),
      headers: { "x-wjb-device-id": deviceId, "x-wjb-generation": "1" },
    });
    if (r.status !== 200 || r.value?.state !== "ready")
      throw Error("ASSET_UPLOAD_" + r.status + "_" + JSON.stringify(r.value));
    await mig(job, "attest", { manifestHash: mh, objectId: a.objectId });
  }
  report.timing.assetsSeconds = (Date.now() - t) / 1000;
  // 예전 한도(64KiB)를 넘는 그림. 크기는 WJB_LIVE_FIRST_ASSET_BYTES(기본 5MB) — 이 작업 환경은 업로드가 느려 512KB로 돌림
  check("large_image_uploaded_and_attested", m.assets[0].bytes > 65536, {
    assets: m.assets.length,
    firstBytes: m.assets[0].bytes,
  });
  // 다른 계정 토큰 없이 그림 읽기 거절
  const anon = await fetch(`${gw}/v2/workspaces/${m.workspaceId}/assets/${m.assets[0].objectId}/content`, {
    headers: { "x-wjb-device-id": deviceId, "x-wjb-generation": "1" },
  });
  check("asset_read_requires_token", anon.status === 401);

  // 5) 게시 → 다시 읽기
  const op = randomUUID();
  const pub = await mig(job, "publication", { manifestHash: mh, operationId: op });
  const prep = await mig(job, "prepare_publish", {
    manifestHash: mh,
    operationId: op,
    expectedFence: pub.serverFence,
  });
  const receipt = await mig(job, "publish", {
    manifestHash: mh,
    operationId: op,
    token: prep.token,
    fence: prep.fence,
  });
  check(
    "published_poc_receipt",
    receipt.receipt?.status === "poc-verified" || receipt.status === "poc-verified",
    { keys: Object.keys(receipt) },
  );
  t = Date.now();
  const back = await mig(job, "workspace", { manifestHash: mh });
  report.timing.readBackSeconds = (Date.now() - t) / 1000;
  check(
    "read_back_lossless",
    JSON.stringify(back.envelope) === JSON.stringify(Object.assign({}, m)) ||
      back.envelope?.records?.length === m.records.length,
    { records: back.envelope?.records?.length },
  );
  const got = await fetch(`${gw}/v2/workspaces/${m.workspaceId}/assets/${m.assets[0].objectId}/content`, {
    headers: { authorization: `Bearer ${token}`, "x-wjb-device-id": deviceId, "x-wjb-generation": "1" },
  });
  const gotBytes = Buffer.from(await got.arrayBuffer());
  check("image_download_matches", got.status === 200 && sha(gotBytes) === m.assets[0].sha256);

  // G-5: 게시한 공간을 서버에서 지우기 → 그림 실물 삭제(gateway 작업자) → 용량 반환
  const del = await post("/v2/lifecycle/delete_space", { deviceId, params: { workspaceId: m.workspaceId } });
  check("delete_space_accepted", del.status === 200 && del.value?.state === "purging", {
    status: del.status,
  });
  let purged = null;
  for (let i = 0; i < 12 && !purged; i++) {
    await post("/v2/account/usage", { deviceId, params: {} }); // 뒤에서 정리를 한 번 더 돌린다
    await new Promise((r) => setTimeout(r, 2500));
    const q = await sql(
      `SELECT (SELECT count(*) FROM wjb_gateway.asset WHERE workspace_id='${m.workspaceId}' AND state<>'canceled') live,(SELECT used_bytes FROM wjb_gateway.workspace WHERE id='${m.workspaceId}') used,(SELECT count(*) FROM storage.objects WHERE bucket_id='${bucket}' AND name LIKE '${m.workspaceId}/%') objects;`,
    );
    if (String(q[0]?.live) === "0" && String(q[0]?.used) === "0" && String(q[0]?.objects) === "0")
      purged = q[0];
  }
  check("delete_space_purges_objects_and_quota", !!purged);
  const gone = await fetch(`${gw}/v2/workspaces/${m.workspaceId}/assets/${m.assets[0].objectId}/content`, {
    headers: { authorization: `Bearer ${token}`, "x-wjb-device-id": deviceId, "x-wjb-generation": "1" },
  });
  check("deleted_image_not_readable", gone.status !== 200, { status: gone.status });

  // 6) 두 번째 작업: 올리다 취소 → 그림 부재 확인 → 취소 완료
  const { m: m2 } = envelope();
  created.workspaces.push(m2.workspaceId);
  const job2 = randomUUID();
  created.jobs.push(job2);
  const h2 = Object.fromEntries(Object.entries(m2).filter(([k]) => k !== "records"));
  const p2 = [];
  for (let i = 0; i < m2.records.length; i += 1000) p2.push(m2.records.slice(i, i + 1000));
  await mig(job2, "upload_begin", { header: h2, pages: p2.length, records: m2.records.length });
  for (let i = 0; i < p2.length; i++) await mig(job2, "upload_page", { index: i, records: p2[i] });
  const s2 = await mig(job2, "start_upload", {});
  const c = await mig(job2, "cancel", { manifestHash: s2.manifestHash, operationId: randomUUID() });
  for (const a of m2.assets)
    await mig(job2, "confirm-absent", { manifestHash: s2.manifestHash, objectId: a.objectId });
  const fin = await mig(job2, "finish_cancel", { manifestHash: s2.manifestHash });
  const used = await sql(`SELECT used_bytes FROM wjb_gateway.workspace WHERE id='${m2.workspaceId}';`);
  check(
    "cancel_cleans_quota",
    c.publishBlocked === true && fin.state === "canceled" && String(used[0]?.used_bytes) === "0",
  );

  // G-5 + G-4: 두 번째 가상 계정이 스스로 계정 삭제 → gateway가 새 키로 Auth 사용자를 지운다
  const email2 = `wjb-copy-${randomUUID()}@example.invalid`;
  const u2 = await admin("POST", "/auth/v1/admin/users", { email: email2, email_confirm: true });
  created.users.push(u2.body.id);
  const link2 = await admin("POST", "/auth/v1/admin/generate_link", { type: "magiclink", email: email2 });
  const v2 = await fetch(`${origin}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: publishable, "content-type": "application/json" },
    body: JSON.stringify({
      type: "email",
      email: email2,
      token: link2.body?.email_otp ?? link2.body?.properties?.email_otp,
    }),
  });
  const firstToken = token;
  token = (await v2.json()).access_token;
  const device2 = randomUUID();
  created.devices.push(device2);
  await post("/v2/devices", { deviceId: device2 });
  const da = await post("/v2/lifecycle/delete_account", { deviceId: device2, params: {} });
  token = firstToken;
  let authGone = false;
  for (let i = 0; i < 12 && !authGone; i++) {
    await post("/v2/account/usage", { deviceId, params: {} });
    await new Promise((r) => setTimeout(r, 2500));
    authGone = (await admin("GET", `/auth/v1/admin/users/${u2.body.id}`)).status === 404;
  }
  check("delete_account_removes_auth_user", da.status === 200 && da.value?.state === "purging" && authGone, {
    status: da.status,
  });
} catch (e) {
  report.failure = /^[A-Z0-9_]{1,120}$/.test(e.message) ? e.message : String(e.message).slice(0, 200);
  console.log("ERROR", report.failure);
} finally {
  // 정리: 객체 → 메타데이터 → 기기 → 계정, 잔여 확인
  const cleanup = {};
  try {
    for (const ws of created.workspaces) {
      const list = await admin("POST", `/storage/v1/object/list/${bucket}`, { prefix: ws, limit: 100 });
      const names = (list.body ?? []).map((o) => `${ws}/${o.name}`);
      if (names.length) await admin("DELETE", `/storage/v1/object/${bucket}`, { prefixes: names });
    }
    for (let i = 0; i < created.jobs.length; i++) {
      const j = created.jobs[i],
        ws = created.workspaces[i];
      await sql(
        `BEGIN;DELETE FROM wjb_migration.upload_page WHERE upload_id='${j}';DELETE FROM wjb_migration.upload WHERE id='${j}';DELETE FROM wjb_migration.workspace_record WHERE job_id='${j}';DELETE FROM wjb_migration.workspace_header WHERE job_id='${j}';DELETE FROM wjb_migration.document WHERE job_id='${j}';DELETE FROM wjb_migration.asset WHERE job_id='${j}';DELETE FROM wjb_migration.job WHERE id='${j}';` +
          (ws
            ? `DELETE FROM wjb_life.orphan WHERE workspace_id='${ws}';DELETE FROM wjb_life.purge WHERE workspace_id='${ws}';DELETE FROM wjb_sync.record WHERE workspace_id='${ws}';DELETE FROM wjb_sync.applied WHERE workspace_id='${ws}';DELETE FROM wjb_sync.asset_declared WHERE workspace_id='${ws}';DELETE FROM wjb_sync.space WHERE workspace_id='${ws}';DELETE FROM wjb_ops.space_bytes WHERE workspace_id='${ws}';DELETE FROM wjb_gateway.recovery_audit WHERE workspace_id='${ws}';DELETE FROM wjb_gateway.io_intent WHERE workspace_id='${ws}';DELETE FROM wjb_gateway.asset WHERE workspace_id='${ws}';DELETE FROM wjb_gateway.workspace WHERE id='${ws}';`
            : "") +
          "COMMIT;",
      );
    }
    await sql(`DELETE FROM wjb_gateway.device WHERE id='${deviceId}';`);
    for (const d of created.devices) await sql(`DELETE FROM wjb_gateway.device WHERE id='${d}';`);
    for (const id of created.users) await sql(`DELETE FROM wjb_life.account_gone WHERE user_id='${id}';`);
    for (const id of created.users) {
      await sql(`DELETE FROM wjb_v2_cloud.blocked_session WHERE user_id='${id}';`);
      await admin("DELETE", `/auth/v1/admin/users/${id}`);
    }
    // 이 시험이 만든 것만 센다(개발 서버의 다른 자료는 건드리지도 세지도 않음)
    const ids = (a) => (a.length ? a.map((x) => `'${x}'`).join(",") : "NULL");
    const left = await sql(
      `SELECT (SELECT count(*) FROM wjb_migration.job WHERE id IN (${ids(created.jobs)})) jobs,(SELECT count(*) FROM wjb_migration.upload WHERE id IN (${ids(created.jobs)})) uploads,(SELECT count(*) FROM wjb_migration.workspace_record WHERE job_id IN (${ids(created.jobs)})) records,(SELECT count(*) FROM wjb_gateway.workspace WHERE id IN (${ids(created.workspaces)})) workspaces,(SELECT count(*) FROM wjb_gateway.asset WHERE workspace_id IN (${ids(created.workspaces)})) assets,(SELECT count(*) FROM wjb_gateway.device WHERE id='${deviceId}') devices,(SELECT count(*) FROM storage.objects WHERE bucket_id='${bucket}' AND split_part(name,'/',1) IN (${ids(created.workspaces)})) objects,(SELECT count(*) FROM auth.users WHERE id IN (${ids(created.users)})) users;`,
    );
    Object.assign(cleanup, left[0]);
    cleanup.zero = Object.values(left[0]).every((n) => String(n) === "0");
  } catch (e) {
    cleanup.error = String(e.message).slice(0, 120);
  }
  report.cleanup = cleanup;
  report.passed =
    !report.failure && checks.length >= 10 && checks.every((c) => c.passed) && cleanup.zero === true;
  report.finishedAt = new Date().toISOString();
  writeFileSync(
    new URL("../../../docs/v2-design/evidence/preview-dev-paged-copy-live.json", import.meta.url),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify({ passed: report.passed, timing: report.timing, cleanup }));
  if (!report.passed) process.exitCode = 1;
}
