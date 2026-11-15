// 010 페이지 업로드 명령의 서버 RPC 전달 계층(C-1a, docs/v2-design/81) — 가짜 전송, 네트워크 없음
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMigrationRPC } from "./server-rpc.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const principal = { userId: id(1), sessionId: id(2), role: "authenticated" },
  device = id(3),
  job = id(4);
const header = {
  profile: "workspace-db20-map-poc-1",
  workspaceId: id(5),
  sourceSchema: 20,
  contractFingerprint: "c".repeat(64),
  sourceManifestHash: "f".repeat(64),
  assets: [],
  tableStats: {},
  exclusions: [],
  policies: {},
};
function rpc(reply, allowWorkspaceProfiles = true) {
  const sent = [];
  const client = createMigrationRPC({
    projectRef: "vsphftnmfzfoufasjttd",
    serviceRoleKey: "fictional-local-runtime-key",
    allowWorkspaceProfiles,
    fetchTransport: async (url, options) => {
      const body = JSON.parse(options.body).p_request;
      sent.push(body);
      const [status, value] = reply(body);
      return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    },
  });
  return { client, sent };
}
const call = (client, action, params) => client.call({ action, jobId: job, params }, principal, device);

test("upload_begin/page/status/start reach the server with checked shapes; page hash computed server-side", async () => {
  const records = [{ table: "category", key: "k".repeat(64), value: { id: "c1" } }];
  const { client, sent } = rpc((b) => {
    if (b.action === "upload_begin") return [200, { uploadId: job, pages: 1, records: 1, received: [] }];
    if (b.action === "upload_page") return [200, { uploadId: job, index: 0, stored: true }];
    if (b.action === "upload_status")
      return [200, { uploadId: job, started: false, pages: 1, records: 1, received: [0] }];
    return [
      200,
      {
        jobId: job,
        state: "staging",
        manifestHash: "a".repeat(64),
        profile: header.profile,
        workspaceId: header.workspaceId,
        sourceManifestHash: header.sourceManifestHash,
      },
    ];
  });
  assert.deepEqual((await call(client, "upload_begin", { header, pages: 1, records: 1 })).received, []);
  await call(client, "upload_page", { index: 0, records });
  assert.equal(sent[1].params.sha256, createHash("sha256").update(JSON.stringify(records)).digest("hex"));
  assert.deepEqual((await call(client, "upload_status", {})).received, [0]);
  assert.equal((await call(client, "start_upload", {})).state, "staging");
  assert.deepEqual(
    sent.map((b) => b.action),
    ["upload_begin", "upload_page", "upload_status", "start_upload"],
  );
  for (const b of sent)
    assert.deepEqual(
      [b.userId, b.sessionId, b.deviceId, b.jobId],
      [principal.userId, principal.sessionId, device, job],
    );
});

test("malformed upload shapes never reach the transport", async () => {
  const { client, sent } = rpc(() => [200, {}]);
  const bad = [
    ["upload_begin", { header: { ...header, records: [] }, pages: 1, records: 1 }],
    ["upload_begin", { header, pages: 1, records: 1001 }],
    ["upload_begin", { header, pages: 3, records: 2 }],
    ["upload_begin", { header, pages: 21, records: 20001 }],
    ["upload_begin", { header: { ...header, profile: "migration-document-poc-1" }, pages: 1, records: 1 }],
    ["upload_page", { index: 0, records: [] }],
    ["upload_page", { index: 32, records: [{}] }],
    ["upload_page", { index: 0, records: [{}], sha256: "0".repeat(64) }],
    ["upload_status", { extra: 1 }],
    ["start_upload", { manifestHash: "a".repeat(64) }],
  ];
  for (const [action, params] of bad)
    await assert.rejects(call(client, action, params), { code: "INVALID_RPC" }, action);
  assert.equal(sent.length, 0);
  const minimal = rpc(() => [200, {}], false);
  await assert.rejects(call(minimal.client, "upload_status", {}), { code: "MIGRATION_PROFILE_UNSUPPORTED" });
});

test("upload errors map to fixed codes; foreign responses rejected", async () => {
  for (const code of [
    "MIGRATION_UPLOAD_NOT_FOUND",
    "MIGRATION_UPLOAD_INCOMPLETE",
    "MIGRATION_PAGE_CHANGED",
  ]) {
    const { client } = rpc(() => [400, { code: "P0001", message: code }]);
    await assert.rejects(call(client, "upload_status", {}), { code });
  }
  const wrongJob = rpc(() => [200, { uploadId: id(9), index: 0, stored: true }]);
  await assert.rejects(call(wrongJob.client, "upload_page", { index: 0, records: [{}] }), {
    code: "MIGRATION_UNAVAILABLE",
  });
  const badStart = rpc(() => [
    200,
    {
      jobId: job,
      state: "staging",
      manifestHash: "x",
      profile: header.profile,
      workspaceId: id(5),
      sourceManifestHash: "f".repeat(64),
    },
  ]);
  await assert.rejects(call(badStart.client, "start_upload", {}), { code: "MIGRATION_UNAVAILABLE" });
});
