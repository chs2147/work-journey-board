// Explicit DEV-only, bounded synthetic migration integration. Never imported by product.
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixture18 } from "../../v2-sync/fixture18.mjs";
import { enrich } from "../fixture-full-workspace.mjs";
import { hash, sourceHash } from "../../v2-sync/model.mjs";
import { createConnectedCopy, inspectConnectedCopy } from "../../v2-assets/connected-copy.mjs";
import { mapWorkspace } from "../workspace-map.mjs";
import { openMigrationJournal } from "../journal.mjs";
import { createWorkspaceStorageGateway } from "../workspace-storage.mjs";
import { advanceWorkspaceSession } from "../workspace-session.mjs";
import { createSupabaseRest } from "../../v2-gateway/supabase-rest.mjs";
import { createSessionVerifier } from "../../v2-auth/session-adapter.mjs";
import { createMigrationRPC } from "../server-rpc.mjs";

const ref = "vsphftnmfzfoufasjttd",
  origin = `https://${ref}.supabase.co`,
  bucket = "wjb-v2-poc-private";
if (
  process.argv.slice(2).join(" ") !== "--run-development-fixtures --free-usage-confirmed" ||
  process.env.WJB_CLOUD_ENV !== "development" ||
  process.env.WJB_SUPABASE_DEV_PROJECT_REF !== ref
)
  throw Error("EXPLICIT_DEV_FIXTURE_REQUIRED");
const key = process.env.WJB_SUPABASE_DEV_SERVICE_ROLE_KEY,
  management = process.env.WJB_SUPABASE_DEV_MANAGEMENT_TOKEN;
if (!key || !management) throw Error("DEV_CREDENTIALS_REQUIRED");
const evidence = new URL("../../../docs/v2-design/evidence/migration-dev-live-check.json", import.meta.url);
const report = {
  startedAt: new Date().toISOString(),
  projectRef: ref,
  checks: [],
  requests: 0,
  storagePosts: 0,
  storagePostBytes: 0,
  outboundBodyBytes: 0,
  productionTouched: false,
  mailSent: false,
  publicGatewayDeployed: false,
  cleanup: {},
};
const users = [],
  devices = [],
  fixtures = [],
  trackedPaths = new Set();
let bucketCreated = false,
  currentStep = "preflight";
async function save() {
  await writeFile(evidence, JSON.stringify(report, null, 2) + "\n");
}
function check(name, passed, details = {}) {
  report.checks.push({ name, passed: Boolean(passed), ...details });
  console.log(JSON.stringify({ check: name, passed: Boolean(passed) }));
  if (!passed) throw Error("CHECK_FAILED");
}
async function outbound(url, options = {}, cleanup = false) {
  const target = new URL(url);
  if (
    target.origin !== origin &&
    (target.origin !== "https://api.supabase.com" || target.pathname !== `/v1/projects/${ref}/database/query`)
  )
    throw Error("DESTINATION_DENIED");
  report.requests++;
  if (!cleanup && report.requests > 350) throw Error("REQUEST_BUDGET");
  const bytes = options.body ? Buffer.byteLength(options.body) : 0;
  report.outboundBodyBytes += bytes;
  if (target.pathname.startsWith(`/storage/v1/object/${bucket}/`) && options.method === "POST") {
    report.storagePosts++;
    report.storagePostBytes += bytes;
    if (report.storagePosts > 6 || bytes > 65536) throw Error("STORAGE_WRITE_BUDGET");
  }
  return fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(20000) });
}
async function api(path, { method = "GET", data, access, cleanup = false } = {}) {
  const r = await outbound(
    origin + path,
    {
      method,
      headers: { apikey: key, authorization: `Bearer ${access || key}`, "content-type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    },
    cleanup,
  );
  let body;
  try {
    body = await r.json();
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
    throw Error("DEV_SQL_UNAVAILABLE");
  }
  return r.json();
}
function fixture(version) {
  const root = mkdtempSync(join(tmpdir(), "wjb-live-migration-"));
  const localRoot = join(root, "original"),
    stateRoot = join(root, "connected");
  for (const p of [localRoot, stateRoot]) {
    mkdirSync(p);
    writeFileSync(join(p, ".v2-poc-only"), "synthetic");
  }
  const source = join(localRoot, "source.db");
  fixture18(source);
  const db = new DatabaseSync(source);
  try {
    enrich(db);
    if (version === 19) {
      db.exec(
        readFileSync(
          new URL("../../../src/data/migrations/0019_note_delete_lock.sql", import.meta.url),
          "utf8",
        ),
      );
      db.exec(
        "UPDATE app_meta SET value='19' WHERE key='schema_version'; UPDATE cabi_note SET delete_locked=1 WHERE id='n1'",
      );
    }
  } finally {
    db.close();
  }
  const workspaceId = randomUUID(),
    directory = join(stateRoot, "copy");
  createConnectedCopy(source, directory, { workspaceId, sourceWorkspaceId: randomUUID() });
  const options = { protectedLocalRoots: [localRoot] },
    path = join(stateRoot, "journal.db"),
    journal = openMigrationJournal(path, options),
    actor = { ownerId: users[0].id, deviceId: devices[0] };
  const job = journal.create({ directory, workspaceId, ...actor }),
    mapped = mapWorkspace(directory, workspaceId);
  const e = {
    root,
    source,
    directory,
    path,
    options,
    journal,
    actor,
    job,
    mapped,
    workspaceId,
    version,
    before: sourceHash(source),
  };
  fixtures.push(e);
  for (const b of inspectConnectedCopy(directory, workspaceId).blobs) trackedPaths.add(b.object_key);
  return e;
}
try {
  const installed = JSON.parse(
    readFileSync(
      new URL("../../../docs/v2-design/evidence/migration-dev-install.json", import.meta.url),
      "utf8",
    ),
  );
  check("reviewed_module_install_record", installed.applied === true && installed.projectRef === ref);
  for (const entry of installed.sources) {
    const path = new URL("../../../" + entry.path, import.meta.url);
    check(
      "installed_source_" + entry.path.split("/").at(-1),
      createHash("sha256").update(readFileSync(path)).digest("hex") === entry.sha256,
    );
  }
  const v = await sql(readFileSync(new URL("../postgres/005-workspace-verify.sql", import.meta.url), "utf8"));
  check(
    "live_module_acl_rls",
    v[0]?.jsonb_build_object.tables === 5 &&
      v[0].jsonb_build_object.rlsTables === 5 &&
      v[0].jsonb_build_object.serviceRPC &&
      !v[0].jsonb_build_object.clientRPC &&
      !v[0].jsonb_build_object.directTableAccess &&
      !v[0].jsonb_build_object.privateExecute,
  );
  const buckets = await api("/storage/v1/bucket");
  check(
    "no_bucket_collision",
    buckets.status === 200 && Array.isArray(buckets.body) && !buckets.body.some((b) => b.id === bucket),
  );
  const jwks = await api("/auth/v1/.well-known/jwks.json");
  check("dev_public_jwks", jwks.status === 200);
  const rest = createSupabaseRest({ projectRef: ref, serviceRoleKey: key, fetchTransport: outbound });
  const verify = createSessionVerifier({
    projectRef: ref,
    jwks: jwks.body,
    callServerRpc: rest.callServerRpc,
  });
  for (let i = 0; i < 2; i++) {
    currentStep = "auth-" + i;
    const id = randomUUID(),
      email = `wjb-migration-${id}@example.invalid`,
      password = randomBytes(32).toString("base64url");
    users.push({ id });
    await save();
    const created = await api("/auth/v1/admin/users", {
      method: "POST",
      data: { id, email, password, email_confirm: true, user_metadata: { fixture: "wjb-v2-migration-dev" } },
    });
    check("fixture_user_" + i, [200, 201].includes(created.status) && created.body?.id === id);
    const login = await api("/auth/v1/token?grant_type=password", {
      method: "POST",
      data: { email, password },
    });
    check("fixture_login_" + i, login.status === 200 && typeof login.body?.access_token === "string");
    users[i].token = login.body.access_token;
    users[i].principal = await verify(users[i].token);
    check("verified_subject_" + i, users[i].principal.userId === id);
    const device = randomUUID();
    devices.push(device);
    await sql(
      `INSERT INTO wjb_gateway.device(id,user_id,session_id) VALUES('${device}','${id}','${users[i].principal.sessionId}');`,
    );
  }
  currentStep = "bucket";
  const created = await api("/storage/v1/bucket", {
    method: "POST",
    data: {
      id: bucket,
      name: bucket,
      public: false,
      file_size_limit: 65536,
      allowed_mime_types: ["application/octet-stream"],
    },
  });
  bucketCreated = [200, 201].includes(created.status);
  check("private_bucket_created", bucketCreated);
  const config = await api("/storage/v1/bucket/" + bucket);
  check(
    "private_bucket_limits",
    config.status === 200 && config.body.public === false && Number(config.body.file_size_limit) === 65536,
  );
  for (const [index, version] of [18, 19, 19].entries()) {
    currentStep = "case-" + index;
    const e = fixture(version);
    await save();
    check(
      "all_26_tables_populated_" + index,
      Object.keys(e.mapped.envelope.tableStats).length === 26 &&
        Object.values(e.mapped.envelope.tableStats).every((s) => s.mappedRows > 0),
    );
    let lose = index === 1 ? "mark_ready" : index === 2 ? "prepare_publish" : null,
      puts = 0;
    const gateway = createWorkspaceStorageGateway({
      projectRef: ref,
      serviceRoleKey: key,
      principal: users[0].principal,
      deviceId: devices[0],
      fetchTransport: async (url, options) => {
        const action = url.pathname.startsWith("/rest/") ? JSON.parse(options.body).p_request?.action : null;
        if (url.pathname.startsWith(`/storage/v1/object/${bucket}/`) && options.method === "POST") puts++;
        const r = await outbound(url, options);
        if (r.ok && ((lose === action && action) || (lose === "delete" && options.method === "DELETE"))) {
          lose = null;
          await r.arrayBuffer();
          throw Error("Injected fixture response loss");
        }
        return r;
      },
    });
    const run = async () => {
      const principal = await verify(users[0].token);
      return advanceWorkspaceSession({
        journal: e.journal,
        id: e.job.id,
        actor: e.actor,
        directory: e.directory,
        principal,
        ...gateway,
      });
    };
    const reopen = () => {
      e.journal.close();
      e.journal = openMigrationJournal(e.path, e.options);
    };
    let result;
    if (index === 0) result = await run();
    if (index === 1) {
      let failed = false;
      try {
        await run();
      } catch {
        failed = true;
      }
      check("lost_ready_injected", failed);
      reopen();
      lose = "publish";
      failed = false;
      try {
        await run();
      } catch {
        failed = true;
      }
      check("lost_publish_injected", failed);
      reopen();
      rmSync(e.directory, { recursive: true });
      result = await run();
    }
    if (index === 2) {
      let failed = false;
      try {
        await run();
      } catch {
        failed = true;
      }
      check("lost_prepare_injected", failed);
      e.journal.requestCancel(e.job.id, e.actor);
      lose = "delete";
      failed = false;
      try {
        await run();
      } catch {
        failed = true;
      }
      check("lost_delete_injected", failed);
      reopen();
      rmSync(e.directory, { recursive: true });
      result = await run();
    }
    check(
      "outcome_" + index,
      result.state === (index === 2 ? "canceled" : "poc-verified") &&
        result.productActivationAllowed === false,
    );
    check("one_physical_upload_" + index, puts === 1);
    check("original_unchanged_" + index, sourceHash(e.source) === e.before);
    const bound = e.journal.get(e.job.id, e.actor);
    check(
      "separate_manifest_hashes_" + index,
      bound.binding.source_manifest_hash !== bound.binding.target_manifest_hash &&
        bound.state !== "connected",
    );
    const stats = await sql(
      `SELECT (SELECT count(*) FROM wjb_migration.workspace_record WHERE job_id='${e.job.id}') AS records,(SELECT count(*) FROM wjb_migration.workspace_record WHERE job_id='${e.job.id}' AND table_name IN('note_asset','cabi_asset') AND (value ? 'data' OR value ? 'thumb')) AS inline_rows,(SELECT used_bytes FROM wjb_gateway.workspace WHERE id='${e.workspaceId}') AS used_bytes;`,
    );
    check(
      "metadata_count_and_no_image_body_" + index,
      Number(stats[0].records) === e.mapped.envelope.records.length && Number(stats[0].inline_rows) === 0,
    );
    if (index === 2) check("cancel_quota_zero", Number(stats[0].used_bytes) === 0);
    else {
      const fetched = await gateway.rpc.call(
        {
          action: "workspace",
          jobId: e.job.id,
          params: { manifestHash: bound.binding.target_manifest_hash },
        },
        users[0].principal,
        devices[0],
      );
      check("full_roundtrip_" + index, hash(fetched.envelope) === e.mapped.mappingHash);
      if (version === 19)
        check(
          "delete_lock_retained",
          fetched.envelope.records.some((r) => r.table === "cabi_note" && r.value.delete_locked === 1),
        );
      const other = createMigrationRPC({
        projectRef: ref,
        serviceRoleKey: key,
        fetchTransport: outbound,
        allowWorkspaceProfiles: true,
      });
      let denied = false;
      try {
        await other.call(
          { action: "status", jobId: e.job.id, params: { manifestHash: bound.binding.target_manifest_hash } },
          users[1].principal,
          devices[1],
        );
      } catch (error) {
        denied = error.code === "MIGRATION_ACCESS_DENIED";
      }
      check("other_account_denied_" + index, denied);
      const asset = e.mapped.envelope.assets[0];
      const raw = await api(`/storage/v1/object/authenticated/${bucket}/${e.workspaceId}/${asset.objectId}`, {
        access: users[1].token,
      });
      check("other_account_direct_storage_denied_" + index, raw.status >= 400);
    }
  }
} catch (e) {
  report.failure = {
    step: currentStep,
    type: e.name,
    code: /^[A-Z][A-Z0-9_]{0,80}$/.test(e.code || "") ? e.code : null,
  };
} finally {
  for (const e of fixtures) {
    try {
      e.journal.close();
    } catch {}
  }
  if (bucketCreated) {
    try {
      const del = await api("/storage/v1/object/" + bucket, {
        method: "DELETE",
        data: { prefixes: [...trackedPaths] },
        cleanup: true,
      });
      const remains = await sql(
        `SELECT count(*) AS n FROM storage.objects WHERE bucket_id='${bucket}';`,
        true,
      );
      report.cleanup.objectsAbsent = [200, 204].includes(del.status) && Number(remains[0]?.n) === 0;
      if (report.cleanup.objectsAbsent)
        await api("/storage/v1/bucket/" + bucket, { method: "DELETE", cleanup: true });
      const b = await api("/storage/v1/bucket", { cleanup: true });
      report.cleanup.bucketAbsent = b.status === 200 && !b.body.some((b) => b.id === bucket);
    } catch {
      report.cleanup.objectsAbsent = false;
      report.cleanup.bucketAbsent = false;
    }
  }
  try {
    for (const e of fixtures) {
      await sql(
        `BEGIN;DELETE FROM wjb_migration.workspace_record WHERE job_id='${e.job.id}';DELETE FROM wjb_migration.workspace_header WHERE job_id='${e.job.id}';DELETE FROM wjb_migration.document WHERE job_id='${e.job.id}';DELETE FROM wjb_migration.asset WHERE job_id='${e.job.id}';DELETE FROM wjb_migration.job WHERE id='${e.job.id}';DELETE FROM wjb_gateway.recovery_audit WHERE workspace_id='${e.workspaceId}';DELETE FROM wjb_gateway.io_intent WHERE workspace_id='${e.workspaceId}';DELETE FROM wjb_gateway.asset WHERE workspace_id='${e.workspaceId}';DELETE FROM wjb_gateway.workspace WHERE id='${e.workspaceId}';COMMIT;`,
        true,
      );
    }
    for (const d of devices) await sql(`DELETE FROM wjb_gateway.device WHERE id='${d}';`, true);
    for (const u of users)
      await sql(`DELETE FROM wjb_v2_cloud.blocked_session WHERE user_id='${u.id}';`, true);
    const remaining = await sql(
      "SELECT (SELECT count(*) FROM wjb_migration.job) AS jobs,(SELECT count(*) FROM wjb_gateway.workspace) AS workspaces,(SELECT count(*) FROM wjb_gateway.asset) AS assets;",
      true,
    );
    report.cleanup.metadataAbsent =
      Number(remaining[0]?.jobs) === 0 &&
      Number(remaining[0]?.workspaces) === 0 &&
      Number(remaining[0]?.assets) === 0;
  } catch {
    report.cleanup.metadataAbsent = false;
  }
  const absent = [];
  for (const u of users) {
    try {
      await api("/auth/v1/admin/users/" + u.id, { method: "DELETE", cleanup: true });
      absent.push((await api("/auth/v1/admin/users/" + u.id, { cleanup: true })).status === 404);
    } catch {
      absent.push(false);
    }
  }
  report.cleanup.authUsersAbsent = absent.every(Boolean);
  report.passed = !report.failure && Object.values(report.cleanup).every(Boolean);
  if (!report.passed)
    report.cleanupIdentifiers = {
      users: users.map((u) => u.id),
      devices,
      workspaces: fixtures.map((e) => ({ jobId: e.job.id, workspaceId: e.workspaceId })),
      bucket: bucketCreated ? bucket : null,
    };
  for (const e of fixtures) rmSync(e.root, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
}
