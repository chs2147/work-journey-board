import { test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { URL } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout, clearTimeout } from "node:timers";
import { fixture18 } from "./fixture18.mjs";
import { convert18 } from "./db18.mjs";
import { importStage, rowId } from "./stage-import.mjs";
import { open, record, working, state, changes, restore, hash, accept } from "./model.mjs";
import { enqueue as legacyEnqueue, flight as legacyFlight, prepare as prepareLegacy } from "./queue.mjs";
import { applyCommand } from "./cells.mjs";
import {
  enqueueMove,
  enqueuePatch,
  freezePatches,
  jobs,
  applyMixed,
  integratedTick,
  integratedState,
} from "./integrated.mjs";
const scope = "u/w",
  id = rowId("entry_item", ["e1"]),
  child = rowId("entry_item", ["e2"]),
  note = rowId("cabi_note", ["n1"]),
  target = { date: "2026-11-03", categoryId: "c1" };
function setup(t, n = 17) {
  const dir = mkdtempSync(join(tmpdir(), "wjb-v2-integrated-"));
  writeFileSync(join(dir, ".v2-poc-only"), "synthetic");
  const src = join(dir, "source.db"),
    stage = join(dir, "stage.db");
  fixture18(src, n);
  convert18(src, stage, scope);
  const handles = [];
  const db = (name) => {
    const d = open(join(dir, name + ".db"));
    handles.push(d);
    return d;
  };
  const a = db("a"),
    b = db("b"),
    s = db("server");
  for (const d of [a, b, s]) importStage(d, stage, scope);
  t.after(() => {
    for (const d of handles)
      try {
        d.close();
      } catch {
        /* reopened */
      }
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, a, b, s, db };
}
function drain(a, s) {
  for (let i = 0; i < 12; i++) {
    const result = integratedTick(a, s, "u", scope);
    if (result !== "sent") return result;
  }
  throw Error("did not settle");
}
function rows(db) {
  return db
    .prepare("SELECT id,rev,body FROM records WHERE scope=? ORDER BY id")
    .all(scope)
    .map((r) => ({ ...r }));
}
function empty(db) {
  assert.deepEqual(integratedState(db, scope), {
    typedJobs: 0,
    typedDrafts: 0,
    legacyDrafts: 0,
    legacyFlights: 0,
    conflicts: 0,
  });
}
for (const n of [17, 41, 73]) {
  test(`integrated/${n}: optimistic subtree, immutable lost-ack job and restart`, (t) => {
    const e = setup(t, n),
      nonEntries = rows(e.s).filter((r) => JSON.parse(r.body).table !== "entry_item");
    const cmd = enqueueMove(e.a, scope, id, target);
    assert.equal(working(e.a, scope, id).row.date, target.date);
    assert.equal(working(e.a, scope, child).row.date, target.date);
    assert.equal(record(e.a, scope, id).body.row.date, "2026-10-30");
    assert.equal(integratedTick(e.a, e.s, "u", scope, { loseAck: true }), "ack-lost");
    assert.deepEqual(jobs(e.a, scope)[0].command, cmd);
    e.a.close();
    const a = e.db("a");
    assert.equal(drain(a, e.s), "idle");
    assert.deepEqual(rows(a), rows(e.s));
    empty(a);
    assert.equal(changes(e.s, scope, 0).length, 1);
    assert.deepEqual(
      rows(e.s).filter((r) => JSON.parse(r.body).table !== "entry_item"),
      nonEntries,
    );
  });
  test(`integrated/${n}: move plus successive edits survive ack loss and coalescing`, (t) => {
    const e = setup(t, n);
    enqueueMove(e.a, scope, id, target);
    enqueuePatch(e.a, scope, id, { text: "first" });
    freezePatches(e.a, scope);
    const original = jobs(e.a, scope).find((j) => j.command.kind === "patch-entry").command;
    enqueuePatch(e.a, scope, id, { text: "second" });
    enqueuePatch(e.a, scope, id, { text: "third" });
    assert.deepEqual(jobs(e.a, scope).find((j) => j.command.kind === "patch-entry").command, original);
    assert.equal(integratedTick(e.a, e.s, "u", scope, { loseAck: true }), "ack-lost");
    e.a.close();
    const a = e.db("a");
    assert.equal(drain(a, e.s), "idle");
    assert.equal(record(e.s, scope, id).body.row.text, "third");
    assert.equal(record(e.s, scope, id).body.row.date, target.date);
    assert.equal(working(a, scope, id).row.text, "third");
    empty(a);
    assert.equal(changes(e.s, scope, 0).length, 3);
  });
  for (const order of ["move-first", "patch-first"])
    test(`integrated/${n}: remote ${order} rebases only independent fields`, (t) => {
      const e = setup(t, n);
      enqueueMove(e.a, scope, id, target);
      enqueuePatch(e.b, scope, child, { text: "remote text" });
      if (order === "move-first") {
        drain(e.a, e.s);
        drain(e.b, e.s);
      } else {
        drain(e.b, e.s);
        drain(e.a, e.s);
      }
      drain(e.a, e.s);
      drain(e.b, e.s);
      empty(e.a);
      empty(e.b);
      assert.deepEqual(rows(e.a), rows(e.b));
      assert.equal(record(e.s, scope, child).body.row.text, "remote text");
      assert.equal(record(e.s, scope, child).body.row.date, target.date);
    });
  test(`integrated/${n}: typed move, legacy note and patch share mixed pages`, (t) => {
    const e = setup(t, n);
    const doc = record(e.a, scope, note).body;
    doc.row.title = "updated note";
    legacyEnqueue(e.a, scope, note, doc);
    enqueueMove(e.a, scope, id, target);
    assert.equal(integratedTick(e.a, e.s, "u", scope), "sent");
    assert.equal(integratedTick(e.a, e.s, "u", scope), "sent");
    enqueuePatch(e.a, scope, id, { text: "mixed" });
    drain(e.a, e.s);
    assert.equal(changes(e.s, scope, 0).length, 3);
    assert.equal(changes(e.s, scope, 0)[1].kind, undefined);
    assert.equal(drain(e.b, e.s), "idle");
    assert.deepEqual(rows(e.b), rows(e.s));
    assert.equal(record(e.b, scope, note).body.row.title, "updated note");
    empty(e.a);
    empty(e.b);
  });
  test(`integrated/${n}: competing moves retain proposal and independent work continues`, (t) => {
    const e = setup(t, n);
    const cmd = enqueueMove(e.a, scope, id, target);
    enqueueMove(e.b, scope, id, { date: "2026-11-04", categoryId: "c1" });
    drain(e.b, e.s);
    assert.equal(drain(e.a, e.s), "conflict");
    assert.deepEqual(jobs(e.a, scope)[0].command, cmd);
    assert.equal(jobs(e.a, scope)[0].status, "conflict");
    assert.equal(working(e.a, scope, id).row.date, target.date);
    assert.equal(record(e.a, scope, id).body.row.date, "2026-11-04");
    enqueuePatch(e.a, scope, rowId("entry_item", ["e5"]), { text: "independent" });
    assert.equal(integratedTick(e.a, e.s, "u", scope), "sent");
    assert.equal(record(e.s, scope, rowId("entry_item", ["e5"])).body.row.text, "independent");
    assert.equal(integratedState(e.a, scope).conflicts, 1);
  });
  test(`integrated/${n}: mixed page failure rolls back data and own ack completion`, (t) => {
    const e = setup(t, n),
      cmd = enqueueMove(e.a, scope, id, target),
      ack = applyCommand(e.s, "u", cmd),
      before = hash(rows(e.a));
    assert.throws(() => applyMixed(e.a, scope, 1, [ack, { ...ack, opId: "gap", seq: 3 }]), /CURSOR_GAP/);
    assert.equal(state(e.a, scope).cursor, 0);
    assert.equal(hash(rows(e.a)), before);
    assert.equal(jobs(e.a, scope)[0].status, "queued");
    assert.equal(working(e.a, scope, id).row.date, target.date);
    assert.equal(drain(e.a, e.s), "idle");
    assert.equal(changes(e.s, scope, 0).length, 1);
    empty(e.a);
  });
}
test("integrated conflicting content is not automatically overwritten", (t) => {
  const e = setup(t);
  enqueuePatch(e.a, scope, id, { text: "mine" });
  enqueuePatch(e.b, scope, id, { text: "theirs" });
  drain(e.b, e.s);
  assert.equal(drain(e.a, e.s), "conflict");
  assert.equal(working(e.a, scope, id).row.text, "mine");
  assert.equal(record(e.s, scope, id).body.row.text, "theirs");
  assert.throws(() => enqueuePatch(e.a, scope, id, { text: "overwrite" }), /RESOLUTION_REQUIRED/);
});
test("integrated foreign edit after own ack conflicts with follow-up draft", (t) => {
  const e = setup(t);
  enqueuePatch(e.a, scope, id, { text: "first" });
  freezePatches(e.a, scope);
  const cmd = jobs(e.a, scope)[0].command;
  enqueuePatch(e.a, scope, id, { text: "later" });
  applyCommand(e.s, "u", cmd);
  applyCommand(e.s, "u", { ...cmd, opId: "remote", contentVersion: 2, patch: { text: "third-party" } });
  assert.equal(drain(e.a, e.s), "conflict");
  assert.equal(working(e.a, scope, id).row.text, "later");
  assert.equal(record(e.s, scope, id).body.row.text, "third-party");
  assert.equal(changes(e.s, scope, 0).length, 2);
});
test("integrated generation/account failure retains complete request and projection", (t) => {
  const e = setup(t),
    cmd = enqueueMove(e.a, scope, id, target);
  assert.throws(() => integratedTick(e.a, e.s, "foreign", scope), /ACCESS_REVOKED/);
  restore(
    e.s,
    "u",
    scope,
    1,
    "restore",
    rows(e.s).map((r) => [r.id, JSON.parse(r.body)]),
  );
  assert.throws(() => integratedTick(e.a, e.s, "u", scope), /GENERATION_CHANGED/);
  assert.deepEqual(jobs(e.a, scope)[0].command, cmd);
  assert.equal(working(e.a, scope, id).row.date, target.date);
});
test("integrated refuses overlapping move, invalid patch and legacy pending collision", (t) => {
  const e = setup(t),
    cmd = enqueueMove(e.a, scope, id, target);
  assert.throws(() => enqueueMove(e.a, scope, id, target), /MOVE_PENDING/);
  assert.throws(() => enqueuePatch(e.a, scope, id, { date: target.date }), /PATCH_FIELDS/);
  assert.deepEqual(jobs(e.a, scope)[0].command, cmd);
  const body = record(e.b, scope, id).body;
  body.row.text = "legacy";
  legacyEnqueue(e.b, scope, id, body);
  assert.throws(() => enqueueMove(e.b, scope, id, target), /RESOLUTION_REQUIRED/);
  assert.throws(() => integratedTick(e.b, e.s, "u", scope), /LEGACY_ENTRY_UPGRADE_REQUIRED/);
  assert.equal(legacyFlight(e.b, scope, id), null);
});
test("integrated same-cell reorder keeps pending child edit", (t) => {
  const e = setup(t);
  enqueuePatch(e.a, scope, child, { text: "child text" });
  enqueueMove(e.a, scope, id, { date: "2026-10-30", categoryId: "c1" });
  assert.equal(drain(e.a, e.s), "idle");
  assert.equal(record(e.s, scope, child).body.row.text, "child text");
  assert.equal(record(e.s, scope, child).body.row.seq, 4);
  empty(e.a);
});
async function kill(e, mode, point) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        new URL("./integrated-crash.mjs", import.meta.url).pathname,
        join(e.dir, "a.db"),
        join(e.dir, "server.db"),
        mode,
        point,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let ready = false,
      error = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("checkpoint timeout " + error));
    }, 5000);
    child.stderr.on("data", (x) => {
      error += x;
    });
    child.stdout.on("data", () => {
      ready = true;
      child.kill("SIGKILL");
    });
    child.on("error", reject);
    child.on("exit", (_code, signal) => {
      clearTimeout(timer);
      if (ready && signal === "SIGKILL") resolve();
      else reject(Error(error || "checkpoint not reached"));
    });
  });
}
for (const point of ["after-job", "after-projection", "after-queued"])
  test(`integrated SIGKILL move ${point}`, async (t) => {
    const e = setup(t);
    e.a.close();
    e.s.close();
    await kill(e, "move", point);
    const a = e.db("a"),
      s = e.db("server");
    assert.equal(a.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    const committed = point === "after-queued";
    assert.equal(jobs(a, scope).length, committed ? 1 : 0);
    assert.equal(working(a, scope, id).row.date, committed ? target.date : "2026-10-30");
    if (committed) {
      drain(a, s);
      empty(a);
      assert.equal(record(s, scope, id).body.row.date, target.date);
    }
  });
test("integrated SIGKILL frozen patch persists exact command", async (t) => {
  const e = setup(t);
  e.a.close();
  e.s.close();
  await kill(e, "freeze", "after-freeze");
  const a = e.db("a"),
    s = e.db("server"),
    cmd = jobs(a, scope)[0].command;
  assert.equal(cmd.patch.text, "frozen edit");
  drain(a, s);
  empty(a);
  assert.deepEqual(jobs(a, scope)[0].command, cmd);
  assert.equal(record(s, scope, id).body.row.text, "frozen edit");
});
for (const point of ["after-sent", "after-server", "after-row", "after-event", "after-apply"])
  test(`integrated SIGKILL sync ${point}`, async (t) => {
    const e = setup(t),
      cmd = enqueueMove(e.a, scope, id, target);
    e.a.close();
    e.s.close();
    await kill(e, "tick", point);
    const a = e.db("a"),
      s = e.db("server");
    assert.equal(a.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(jobs(a, scope)[0].command, cmd);
    assert.equal(state(a, scope).cursor, point === "after-apply" ? 1 : 0);
    assert.equal(working(a, scope, id).row.date, target.date);
    drain(a, s);
    empty(a);
    assert.deepEqual(rows(a), rows(s));
    assert.equal(changes(s, scope, 0).length, 1);
  });

for (const order of ["legacy-first", "typed-first"])
  test(`integrated nested transactions roll back both acknowledgements: ${order}`, (t) => {
    const e = setup(t),
      cmd = enqueueMove(e.a, scope, id, target),
      doc = record(e.a, scope, note).body;
    doc.row.title = "atomic mixed note";
    legacyEnqueue(e.a, scope, note, doc);
    const legacy = prepareLegacy(e.a, scope, note);
    if (order === "legacy-first") {
      accept(e.s, "u", legacy);
      applyCommand(e.s, "u", cmd);
    } else {
      applyCommand(e.s, "u", cmd);
      accept(e.s, "u", legacy);
    }
    const batch = changes(e.s, scope, 0),
      before = hash(rows(e.a));
    assert.throws(() => applyMixed(e.a, scope, 1, [...batch, { ...batch[0], seq: 4 }]), /CURSOR_GAP/);
    assert.equal(hash(rows(e.a)), before);
    assert.equal(state(e.a, scope).cursor, 0);
    assert.equal(jobs(e.a, scope)[0].status, "queued");
    assert.deepEqual(legacyFlight(e.a, scope, note), legacy);
    assert.equal(working(e.a, scope, note).row.title, "atomic mixed note");
    applyMixed(e.a, scope, 1, batch);
    assert.deepEqual(rows(e.a), rows(e.s));
    empty(e.a);
  });
