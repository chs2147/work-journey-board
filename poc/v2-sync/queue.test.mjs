import { test } from "node:test";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import process from "node:process";
import { URL } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout, clearTimeout } from "node:timers";
import { fixture18 } from "./fixture18.mjs";
import { convert18, verifyStage } from "./db18.mjs";
import { importStage, rowId } from "./stage-import.mjs";
import {
  open,
  record,
  working,
  pending,
  accept,
  restore,
  changes,
  state,
  hash,
  operation,
} from "./model.mjs";
import { initQueue, enqueue, prepare, flight, tick, queueState, applyPage } from "./queue.mjs";
const scope = "u/w",
  id = rowId("entry_item", ["e1"]),
  other = rowId("entry_item", ["e3"]);
function setup(t, n = 17) {
  const dir = mkdtempSync(join(tmpdir(), "wjb-v2-queue-"));
  writeFileSync(join(dir, ".v2-poc-only"), "synthetic");
  const source = join(dir, "source.db"),
    stage = join(dir, "stage.db");
  fixture18(source, n);
  convert18(source, stage, scope);
  const handles = [];
  const make = (name) => {
    const path = join(dir, name + ".db"),
      db = open(path);
    handles.push(db);
    initQueue(db);
    return db;
  };
  const a = make("a"),
    b = make("b"),
    s = make("server");
  for (const db of [a, b, s]) importStage(db, stage, scope);
  t.after(() => {
    for (const db of handles)
      try {
        db.close();
      } catch {
        /* reopened */
      }
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, stage, a, b, s, reopen: () => make("a") };
}
function edited(db, key, text) {
  const b = JSON.parse(JSON.stringify(working(db, scope, key)));
  b.row.text = text;
  return b;
}
for (const n of [17, 41, 73]) {
  test(`queue/${n}: import actual DB18 rows and separate image bytes`, (t) => {
    const e = setup(t, n),
      original = verifyStage(e.stage, scope).rows;
    const count = Object.entries(original)
      .filter(([table]) => table !== "app_meta")
      .reduce((s, [, rows]) => s + rows.length, 0);
    assert.equal(e.a.prepare("SELECT count(*) n FROM records WHERE scope=?").get(scope).n, count);
    assert.deepEqual(
      record(e.a, scope, rowId("week_note", ["2026-W44"])).body.row,
      original.week_note.find((r) => r.week_id === "2026-W44"),
    );
    const asset = record(e.a, scope, rowId("note_asset", ["wa"])).body.row;
    assert.equal(asset.data, undefined);
    const bytes = e.a
      .prepare("SELECT bytes FROM local_assets WHERE scope=? AND hash=?")
      .get(scope, asset.dataRef.hash).bytes;
    assert.equal(hash(Buffer.from(bytes)), asset.dataRef.hash);
    assert.equal(bytes.length, asset.dataRef.bytes);
    assert.equal(record(e.a, "u/other", id), null);
    assert.throws(() => importStage(e.a, e.stage, scope), /TARGET_NOT_EMPTY/);
  });
  test(`queue/${n}: immutable flight, coalescing and lost-ack restart converge`, (t) => {
    const e = setup(t, n);
    enqueue(e.a, scope, id, edited(e.a, id, "first"));
    const frozen = prepare(e.a, scope, id);
    enqueue(e.a, scope, id, edited(e.a, id, "second"));
    enqueue(e.a, scope, id, edited(e.a, id, "third"));
    assert.deepEqual(prepare(e.a, scope, id), frozen);
    assert.equal(queueState(e.a, scope).drafts, 1);
    const ack = accept(e.s, "u", frozen);
    assert.deepEqual(accept(e.s, "u", frozen), ack);
    e.a.close();
    const a = e.reopen();
    assert.deepEqual(flight(a, scope, id), frozen);
    assert.equal(tick(a, e.s, "u", scope), "sent");
    assert.equal(tick(a, e.s, "u", scope), "idle");
    assert.equal(record(e.s, scope, id).body.row.text, "third");
    assert.deepEqual(working(a, scope, id), record(e.s, scope, id).body);
    assert.deepEqual(queueState(a, scope), { drafts: 0, flights: 0, conflicts: 0 });
    assert.equal(pending(a, scope).length, 0);
    assert.equal(changes(e.s, scope, 0).length, 2);
  });
  test(`queue/${n}: different entries converge across two devices`, (t) => {
    const e = setup(t, n);
    enqueue(e.a, scope, id, edited(e.a, id, "A"));
    enqueue(e.b, scope, other, edited(e.b, other, "B"));
    tick(e.a, e.s, "u", scope);
    tick(e.b, e.s, "u", scope);
    tick(e.a, e.s, "u", scope);
    for (const key of [id, other]) assert.deepEqual(record(e.a, scope, key), record(e.b, scope, key));
    assert.equal(queueState(e.a, scope).conflicts, 0);
    assert.equal(queueState(e.b, scope).conflicts, 0);
  });
  test(`queue/${n}: concurrent entry preserves original base and does not block other entries`, (t) => {
    const e = setup(t, n),
      base = record(e.a, scope, id).body;
    enqueue(e.a, scope, id, edited(e.a, id, "mine"));
    enqueue(e.b, scope, id, edited(e.b, id, "theirs"));
    tick(e.b, e.s, "u", scope);
    assert.equal(tick(e.a, e.s, "u", scope), "conflict");
    enqueue(e.b, scope, id, edited(e.b, id, "third"));
    tick(e.b, e.s, "u", scope);
    tick(e.a, e.s, "u", scope);
    const conflict = JSON.parse(
      e.a.prepare("SELECT body FROM conflicts WHERE scope=? AND id=?").get(scope, id).body,
    );
    assert.deepEqual(conflict.base.body, base);
    assert.equal(conflict.local.row.text, "mine");
    assert.equal(conflict.remote.body.row.text, "third");
    assert.throws(() => enqueue(e.a, scope, id, edited(e.a, id, "unsafe")), /RESOLUTION_REQUIRED/);
    enqueue(e.a, scope, other, edited(e.a, other, "unrelated"));
    assert.equal(tick(e.a, e.s, "u", scope), "sent");
    assert.equal(record(e.s, scope, other).body.row.text, "unrelated");
  });
  test(`queue/${n}: generation and account failures preserve pending edits`, (t) => {
    const e = setup(t, n);
    enqueue(e.a, scope, id, edited(e.a, id, "offline"));
    const op = prepare(e.a, scope, id);
    assert.throws(() => tick(e.a, e.s, "foreign", scope), /ACCESS_REVOKED/);
    const snapshot = e.s
      .prepare("SELECT id,body FROM records WHERE scope=?")
      .all(scope)
      .map((r) => [r.id, JSON.parse(r.body)]);
    restore(e.s, "u", scope, 1, "restore", snapshot);
    assert.throws(() => tick(e.a, e.s, "u", scope), /GENERATION_CHANGED/);
    assert.deepEqual(flight(e.a, scope, id), op);
    assert.equal(working(e.a, scope, id).row.text, "offline");
    assert.equal(state(e.a, scope).generation, 1);
  });
  test(`queue/${n}: paged pull, duplicate and gap rollback`, (t) => {
    const e = setup(t, n);
    for (let i = 0; i < 5; i++) accept(e.s, "u", operation(e.s, scope, id, edited(e.s, id, "remote" + i)));
    const all = changes(e.s, scope, 0);
    assert.throws(() => applyPage(e.a, scope, 1, [all[0], all[2]]), /CURSOR_GAP/);
    assert.equal(state(e.a, scope).cursor, 0);
    applyPage(e.a, scope, 1, [all[0], all[0], all[1]]);
    assert.equal(state(e.a, scope).cursor, 2);
    assert.equal(tick(e.a, e.s, "u", scope), "idle");
    assert.equal(state(e.a, scope).cursor, 5);
    assert.equal(record(e.a, scope, id).body.row.text, "remote4");
  });
}
async function kill(path, point) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [new URL("./queue-crash.mjs", import.meta.url).pathname, path, point],
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
for (const point of ["after-working", "after-draft", "after-freeze"])
  test(`queue SIGKILL ${point}`, async (t) => {
    const e = setup(t);
    if (point === "after-freeze") enqueue(e.a, scope, id, edited(e.a, id, "frozen"));
    const before = working(e.a, scope, id);
    e.a.close();
    await kill(join(e.dir, "a.db"), point);
    const a = e.reopen();
    assert.equal(a.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    if (point === "after-working") {
      assert.deepEqual(working(a, scope, id), before);
      assert.equal(queueState(a, scope).drafts, 0);
    } else {
      assert.equal(queueState(a, scope)[point === "after-freeze" ? "flights" : "drafts"], 1);
      tick(a, e.s, "u", scope);
      assert.equal(tick(a, e.s, "u", scope), "idle");
    }
  });

test("queue lost tick response resumes after reopening without duplicate commit", (t) => {
  const e = setup(t);
  enqueue(e.a, scope, id, edited(e.a, id, "lost response"));
  assert.equal(tick(e.a, e.s, "u", scope, { loseAck: true }), "ack-lost");
  assert.equal(queueState(e.a, scope).flights, 1);
  e.a.close();
  const a = e.reopen();
  assert.equal(tick(a, e.s, "u", scope), "idle");
  assert.equal(changes(e.s, scope, 0).length, 1);
  assert.equal(pending(a, scope).length, 0);
});
test("queue flight followed by foreign revision preserves later edit as conflict", (t) => {
  const e = setup(t);
  enqueue(e.a, scope, id, edited(e.a, id, "first"));
  const f = prepare(e.a, scope, id);
  enqueue(e.a, scope, id, edited(e.a, id, "later local"));
  accept(e.s, "u", f);
  accept(e.s, "u", operation(e.s, scope, id, edited(e.s, id, "remote intervenes")));
  assert.equal(tick(e.a, e.s, "u", scope), "conflict");
  assert.equal(working(e.a, scope, id).row.text, "later local");
  assert.equal(record(e.s, scope, id).body.row.text, "remote intervenes");
  assert.equal(changes(e.s, scope, 0).length, 2);
});
test("queue foreign revision before flight acceptance blocks stale resend", (t) => {
  const e = setup(t);
  enqueue(e.a, scope, id, edited(e.a, id, "frozen local"));
  prepare(e.a, scope, id);
  accept(e.s, "u", operation(e.s, scope, id, edited(e.s, id, "remote first")));
  assert.equal(tick(e.a, e.s, "u", scope), "conflict");
  assert.equal(queueState(e.a, scope).flights, 1);
  assert.equal(working(e.a, scope, id).row.text, "frozen local");
  assert.equal(changes(e.s, scope, 0).length, 1);
});
test("queue unsent edits coalesce before immutable freeze", (t) => {
  const e = setup(t);
  enqueue(e.a, scope, id, edited(e.a, id, "one"));
  enqueue(e.a, scope, id, edited(e.a, id, "two"));
  assert.equal(queueState(e.a, scope).drafts, 1);
  assert.equal(tick(e.a, e.s, "u", scope), "sent");
  assert.equal(record(e.s, scope, id).body.row.text, "two");
  assert.equal(changes(e.s, scope, 0).length, 1);
});
test("stage import scope mismatch leaves target empty", (t) => {
  const e = setup(t),
    db = open(join(e.dir, "empty.db"));
  try {
    assert.throws(() => importStage(db, e.stage, "u/foreign"), /MANIFEST_SCOPE_FORMAT/);
    assert.equal(db.prepare("SELECT count(*) n FROM records").get().n, 0);
  } finally {
    db.close();
  }
});

for (const [table, key, field] of [
  ["cabi_note", "n1", "content"],
  ["cabi_board", "b1", "doc"],
])
  test(`queue ${table}: concurrent JSON preserves both document copies`, (t) => {
    const e = setup(t),
      docId = rowId(table, [key]);
    function text(db, label) {
      const body = JSON.parse(JSON.stringify(working(db, scope, docId)));
      const doc = JSON.parse(body.row[field]);
      if (field === "doc") doc.boxes[0].content.content[0].content[0].text = label;
      else doc.content[0].content[0].text = label;
      body.row[field] = JSON.stringify(doc);
      return body;
    }
    const mine = text(e.a, "내 문서 / A"),
      theirs = text(e.b, "서버 문서 / B");
    enqueue(e.a, scope, docId, mine);
    enqueue(e.b, scope, docId, theirs);
    tick(e.b, e.s, "u", scope);
    assert.equal(tick(e.a, e.s, "u", scope), "conflict");
    const c = JSON.parse(
      e.a.prepare("SELECT body FROM conflicts WHERE scope=? AND id=?").get(scope, docId).body,
    );
    assert.deepEqual(c.local, mine);
    assert.deepEqual(c.remote.body, theirs);
    assert.equal(e.a.prepare("SELECT count(*) n FROM local_assets WHERE scope=?").get(scope).n, 1);
  });
