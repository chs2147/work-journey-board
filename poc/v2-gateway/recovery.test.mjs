import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createRecoveryWorker, classifyRecovery, recoveryHash } from "./recovery.mjs";
import { GatewayError } from "./io.mjs";
const id = (n) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const principal = { userId: id(1), sessionId: id(7) },
  scope = { workspaceId: id(3), deviceId: id(5), generation: "1" };
const bytes = Buffer.from("recovery fixture"),
  sha256 = createHash("sha256").update(bytes).digest("hex");
function fixture({
  state = "reserved",
  unsettled = 0,
  observation = "valid",
  busy = false,
  generation = "1",
} = {}) {
  const data = {
    clock: 1000000,
    calls: [],
    reads: 0,
    deletes: 0,
    acquires: 0,
    active: true,
    used: bytes.length,
  };
  data.row = {
    ...scope,
    assetId: id(100),
    state,
    ioVersion: "1",
    sha256,
    bytes: bytes.length,
    expires: 1001000,
    unsettled,
    busy,
    generation,
    receipt: null,
  };
  const storage = {
    async get() {
      data.reads++;
      if (data.beforeRead) await data.beforeRead();
      if (observation === "missing" || data.deleted) throw new GatewayError("OBJECT_MISSING", 404);
      if (observation === "unavailable") throw new GatewayError("STORAGE_UNAVAILABLE", 503);
      return observation === "corrupt" ? Buffer.alloc(bytes.length, 1) : bytes;
    },
    async remove() {
      data.deletes++;
      if (data.deleteError) throw new GatewayError("STORAGE_UNAVAILABLE", 503);
      data.deleted = true;
    },
  };
  const worker = createRecoveryWorker({
    clock: () => data.clock,
    verifyAccessToken: async (token) => {
      if (token !== "valid" || !data.active) throw new GatewayError("ACCESS_REVOKED", 403);
      return principal;
    },
    callServerRpc: async (name, args) => {
      data.calls.push({ name, args });
      assert.equal(name, "wjb_v2_recovery_catalog");
      assert.equal(args.p_request.userId, principal.userId);
      return data.badPage || { items: [{ ...data.row }], hasMore: false, nextCursor: null };
    },
    storage,
    metadata: {
      async withAsset(_principal, _scope, mode, fn) {
        data.acquires++;
        assert.equal(mode, "recover");
        return fn({
          row: { ...data.row },
          async recheck() {
            if (data.recheckError) throw new GatewayError("LEASE_LOST", 409);
          },
          async recoverReady(proof) {
            if (data.commitError) throw new GatewayError("METADATA_UNAVAILABLE", 503);
            data.row.state = "ready";
            data.row.receipt = {
              decisionId: proof.decisionId,
              reviewHash: proof.reviewHash,
              action: "RESTORE_READY",
              resultState: "ready",
            };
          },
          async markCleanup() {
            if (data.row.unsettled > 0) throw new GatewayError("CLEANUP_UNCERTAIN", 409);
            data.row.state = "cleanup";
          },
          async recoverCancel(proof) {
            if (data.commitError) throw new GatewayError("METADATA_UNAVAILABLE", 503);
            data.row.state = "canceled";
            data.used = 0;
            data.row.receipt = {
              decisionId: proof.decisionId,
              reviewHash: proof.reviewHash,
              action: "CANCEL",
              resultState: "canceled",
            };
          },
        });
      },
    },
  });
  return {
    ...data,
    data,
    worker,
    preview: () => worker.preview({ token: "valid", scope }),
    apply: (plan, action) => worker.apply({ token: "valid", plan, reviewHash: plan.reviewHash, action }),
  };
}
for (const [label, item, observation, actions] of [
  ["busy", { state: "reserved", busy: true, generation: "1", unsettled: 0 }, "valid", []],
  ["old generation", { state: "reserved", busy: false, generation: "2", unsettled: 0 }, "valid", []],
  ["finished ready", { state: "ready", busy: false, generation: "1", unsettled: 0 }, "valid", []],
  ["corrupt bytes", { state: "reserved", busy: false, generation: "1", unsettled: 0 }, "corrupt", []],
  [
    "unavailable storage",
    { state: "reserved", busy: false, generation: "1", unsettled: 0 },
    "unavailable",
    [],
  ],
  ["missing uncertain", { state: "reserved", busy: false, generation: "1", unsettled: 1 }, "missing", []],
  [
    "valid uncertain",
    { state: "reserved", busy: false, generation: "1", unsettled: 1 },
    "valid",
    ["RESTORE_READY"],
  ],
  [
    "valid settled",
    { state: "reserved", busy: false, generation: "1", unsettled: 0 },
    "valid",
    ["RESTORE_READY", "CANCEL"],
  ],
  ["cleanup settled", { state: "cleanup", busy: false, generation: "1", unsettled: 0 }, "valid", ["CANCEL"]],
  ["cleanup uncertain", { state: "cleanup", busy: false, generation: "1", unsettled: 1 }, "valid", []],
])
  test("classification: " + label, () =>
    assert.deepEqual(classifyRecovery(item, { kind: observation }, scope).actions, actions),
  );
test("preview reads only and caps one page", async () => {
  const f = fixture();
  const p = await f.preview();
  assert.equal(p.readOnly, true);
  assert.equal(f.data.acquires, 0);
  assert.equal(f.data.deletes, 0);
  assert.equal(f.data.row.state, "reserved");
  assert.equal(f.data.calls[0].args.p_request.limit, 8);
});
test("busy row does not read storage", async () => {
  const f = fixture({ busy: true });
  const p = await f.preview();
  assert.equal(p.plans[0].status, "BUSY");
  assert.equal(f.data.reads, 0);
});
test("corrupt file is retained without an action", async () => {
  const f = fixture({ observation: "corrupt" });
  const p = await f.preview();
  assert.equal(p.plans[0].status, "INTEGRITY_REVIEW");
  assert.deepEqual(p.plans[0].actions, []);
});
test("bad catalog shape fails closed", async () => {
  const f = fixture();
  f.data.badPage = { items: new Array(9).fill(f.data.row), hasMore: false, nextCursor: null };
  await assert.rejects(
    () => f.preview(),
    (e) => e.code === "RECOVERY_UNAVAILABLE",
  );
  assert.equal(f.data.reads, 0);
});
test("missing review confirmation prevents acquisition", async () => {
  const f = fixture();
  const plan = (await f.preview()).plans[0];
  await assert.rejects(
    () => f.worker.apply({ token: "valid", plan, reviewHash: "wrong", action: "RESTORE_READY" }),
    (e) => e.code === "REVIEW_REQUIRED",
  );
  assert.equal(f.data.acquires, 0);
});
test("expired review rejected before mutation", async () => {
  const f = fixture();
  const plan = (await f.preview()).plans[0];
  f.data.clock += 60001;
  await assert.rejects(
    () => f.apply(plan, "RESTORE_READY"),
    (e) => e.code === "REVIEW_EXPIRED",
  );
});
test("changed IO epoch requires a new review", async () => {
  const f = fixture();
  const plan = (await f.preview()).plans[0];
  f.data.row.ioVersion = "2";
  await assert.rejects(
    () => f.apply(plan, "RESTORE_READY"),
    (e) => e.code === "RECOVERY_CHANGED",
  );
});
test("storage change after preview prevents cancellation", async () => {
  const f = fixture({ observation: "valid" });
  const plan = (await f.preview()).plans[0];
  f.data.deleted = true;
  await assert.rejects(
    () => f.apply(plan, "CANCEL"),
    (e) => e.code === "RECOVERY_CHANGED",
  );
  assert.equal(f.data.deletes, 0);
});
test("valid uncertain bytes can recover without quota release", async () => {
  const f = fixture({ unsettled: 1 });
  const plan = (await f.preview()).plans[0];
  const r = await f.apply(plan, "RESTORE_READY");
  assert.equal(r.state, "ready");
  assert.equal(f.data.row.unsettled, 1);
  assert.equal(f.data.used, bytes.length);
});
test("unknown missing request cannot be forced through changed plan", async () => {
  const f = fixture({ unsettled: 1, observation: "missing" });
  const plan = (await f.preview()).plans[0];
  plan.actions = ["CANCEL"];
  plan.reviewHash = recoveryHash(plan);
  await assert.rejects(
    () => f.apply(plan, "CANCEL"),
    (e) => e.code === "RECOVERY_CHANGED",
  );
  assert.equal(f.data.deletes, 0);
});
test("settled missing asset can cancel and record completion", async () => {
  const f = fixture({ observation: "missing" });
  const plan = (await f.preview()).plans[0];
  const r = await f.apply(plan, "CANCEL");
  assert.equal(r.state, "canceled");
  assert.equal(f.data.used, 0);
  assert.equal(f.data.row.receipt.decisionId, plan.decisionId);
});
test("replayed completed plan returns receipt without extra delete", async () => {
  const f = fixture({ observation: "missing" });
  const plan = (await f.preview()).plans[0];
  await f.apply(plan, "CANCEL");
  assert.equal((await f.apply(plan, "CANCEL")).status, "ALREADY_APPLIED");
  assert.equal(f.data.deletes, 1);
});
test("delete failure retains cleanup and quota", async () => {
  const f = fixture({ observation: "missing" });
  const plan = (await f.preview()).plans[0];
  f.data.deleteError = true;
  await assert.rejects(
    () => f.apply(plan, "CANCEL"),
    (e) => e.code === "STORAGE_UNAVAILABLE",
  );
  assert.equal(f.data.row.state, "cleanup");
  assert.equal(f.data.used, bytes.length);
});
test("lost publication does not fabricate completion receipt", async () => {
  const f = fixture();
  const plan = (await f.preview()).plans[0];
  f.data.commitError = true;
  await assert.rejects(() => f.apply(plan, "RESTORE_READY"));
  assert.equal(f.data.row.state, "reserved");
  assert.equal(f.data.row.receipt, null);
});
test("revocation after inspection prevents restore", async () => {
  const f = fixture();
  const plan = (await f.preview()).plans[0];
  f.data.beforeRead = () => {
    f.data.active = false;
  };
  await assert.rejects(
    () => f.apply(plan, "RESTORE_READY"),
    (e) => e.code === "ACCESS_REVOKED",
  );
  assert.equal(f.data.row.state, "reserved");
});
