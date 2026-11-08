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
import { open, record, changes, state, hash, restore, working, accept, operation } from "./model.mjs";
import { cellKey, cellRows, cellVersion, contentVersion, applyCommand, receiveBatches } from "./cells.mjs";
import { enqueue, applyPage } from "./queue.mjs";
const scope = "u/w",
  id = rowId("entry_item", ["e1"]),
  child = rowId("entry_item", ["e2"]);
const from = { date: "2026-10-30", categoryId: "c1", version: 1 },
  to = { date: "2026-11-03", categoryId: "c1", version: 0 };
function setup(t, n = 17) {
  const dir = mkdtempSync(join(tmpdir(), "wjb-v2-cells-"));
  writeFileSync(join(dir, ".v2-poc-only"), "synthetic");
  const source = join(dir, "source.db"),
    stage = join(dir, "stage.db");
  fixture18(source, n);
  convert18(source, stage, scope);
  const handles = [];
  const db = (name) => {
    const d = open(join(dir, name + ".db"));
    handles.push(d);
    return d;
  };
  const s = db("server"),
    a = db("a");
  for (const d of [s, a]) importStage(d, stage, scope);
  t.after(() => {
    for (const d of handles)
      try {
        d.close();
      } catch {
        /* closed before worker */
      }
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, s, a, db };
}
const move = (opId = "move") => ({
  kind: "move-subtree",
  scope,
  generation: 1,
  opId,
  id,
  from: { ...from },
  to: { ...to },
  beforeId: null,
});
const patch = (entry, text, version = 1, opId = "patch") => ({
  kind: "patch-entry",
  scope,
  generation: 1,
  opId,
  id: entry,
  contentVersion: version,
  patch: { text },
});
const snapshot = (d) =>
  d
    .prepare("SELECT id,rev,body FROM records WHERE scope=? ORDER BY id")
    .all(scope)
    .map((r) => ({ ...r }));
for (const n of [17, 41, 73]) {
  test(`cells/${n}: parent and children move once, ids/assets/links unchanged`, (t) => {
    const e = setup(t, n),
      before = snapshot(e.s).filter((r) => JSON.parse(r.body).table !== "entry_item"),
      cmd = move();
    const result = applyCommand(e.s, "u", cmd);
    assert.equal(result.seq, 1);
    assert.equal(result.rows.length, 4);
    assert.equal(changes(e.s, scope, 0).length, 1);
    assert.deepEqual(
      cellRows(e.s, scope, cellKey(to.date, to.categoryId)).map((r) => r.body.row.id),
      ["e1", "e2"],
    );
    assert.deepEqual(
      cellRows(e.s, scope, cellKey(from.date, from.categoryId)).map((r) => r.body.row.id),
      ["e3", "e4"],
    );
    assert.equal(record(e.s, scope, child).body.row.depth, 1);
    assert.equal(contentVersion(e.s, scope, id), 1);
    assert.equal(cellVersion(e.s, scope, cellKey(from.date, from.categoryId)), 2);
    assert.equal(cellVersion(e.s, scope, cellKey(to.date, to.categoryId)), 1);
    assert.deepEqual(
      snapshot(e.s).filter((r) => JSON.parse(r.body).table !== "entry_item"),
      before,
    );
    assert.deepEqual(applyCommand(e.s, "u", cmd), result);
    assert.throws(() => applyCommand(e.s, "u", { ...cmd, beforeId: "different" }), /IDEMPOTENCY_KEY_REUSED/);
    receiveBatches(e.a, scope, 1, [result, result]);
    assert.deepEqual(snapshot(e.a), snapshot(e.s));
    assert.equal(state(e.a, scope).cursor, 1);
  });
  for (const order of ["patch-first", "move-first"])
    test(`cells/${n}: ${order} preserves content and membership independently`, (t) => {
      const e = setup(t, n),
        m = move(),
        p = patch(child, "concurrent child edit");
      if (order === "patch-first") {
        applyCommand(e.s, "u", p);
        applyCommand(e.s, "u", m);
      } else {
        applyCommand(e.s, "u", m);
        applyCommand(e.s, "u", p);
      }
      assert.equal(record(e.s, scope, child).body.row.text, "concurrent child edit");
      assert.equal(record(e.s, scope, child).body.row.date, to.date);
      assert.equal(contentVersion(e.s, scope, child), 2);
      assert.equal(cellVersion(e.s, scope, cellKey(to.date, to.categoryId)), 1);
      receiveBatches(e.a, scope, 1, changes(e.s, scope, 0));
      assert.deepEqual(snapshot(e.a), snapshot(e.s));
    });
  test(`cells/${n}: independent entry patches avoid cell-wide conflicts`, (t) => {
    const e = setup(t, n);
    applyCommand(e.s, "u", patch(id, "one", 1, "p1"));
    applyCommand(e.s, "u", patch(child, "two", 1, "p2"));
    assert.equal(cellVersion(e.s, scope, cellKey(from.date, from.categoryId)), 1);
    assert.throws(() => applyCommand(e.s, "u", patch(id, "stale", 1, "p3")), /CONTENT_CONFLICT/);
    assert.equal(record(e.s, scope, id).body.row.text, "one");
  });
  test(`cells/${n}: competing source/destination order version rolls everything back`, (t) => {
    const e = setup(t, n);
    applyCommand(e.s, "u", { ...move("reorder"), to: { ...from }, beforeId: null });
    const before = hash(snapshot(e.s));
    assert.throws(() => applyCommand(e.s, "u", move()), /CELL_CONFLICT/);
    assert.equal(hash(snapshot(e.s)), before);
    assert.equal(state(e.s, scope).cursor, 1);
    const destination = { date: "2026-11-02", categoryId: "c2", version: 0 };
    assert.throws(
      () => applyCommand(e.s, "u", { ...move("bad-to"), from: { ...from, version: 2 }, to: destination }),
      /CELL_CONFLICT/,
    );
  });
  test(`cells/${n}: receive rollback on missing batch sequence, conservative dirty preservation`, (t) => {
    const e = setup(t, n);
    const event = applyCommand(e.s, "u", move());
    const before = hash(snapshot(e.a));
    assert.throws(() => receiveBatches(e.a, scope, 1, [event, { ...event, seq: 3 }]), /CURSOR_GAP/);
    assert.equal(hash(snapshot(e.a)), before);
    assert.equal(state(e.a, scope).cursor, 0);
    const local = record(e.a, scope, id).body;
    local.row.text = "pending local";
    enqueue(e.a, scope, id, local);
    assert.throws(() => applyPage(e.a, scope, 1, [event]), /BATCH_ADAPTER_REQUIRED/);
    assert.equal(state(e.a, scope).cursor, 0);
    receiveBatches(e.a, scope, 1, [event]);
    assert.equal(working(e.a, scope, id).row.text, "pending local");
    assert.equal(record(e.a, scope, id).body.row.date, to.date);
    assert.equal(e.a.prepare("SELECT count(*) n FROM conflicts WHERE scope=?").get(scope).n, 1);
  });
}
const bad = [
  ["child as root", (c) => ({ ...c, id: child }), /ROOT_REQUIRED/],
  ["destination inside subtree", (c) => ({ ...c, to: { ...from }, beforeId: child }), /DESTINATION_REQUIRED/],
  ["invalid date", (c) => ({ ...c, to: { ...to, date: "2026-02-30" } }), /DATE_REQUIRED/],
  ["unknown category", (c) => ({ ...c, to: { ...to, categoryId: "gone" } }), /CATEGORY_REQUIRED/],
  ["stale source", (c) => ({ ...c, from: { ...from, version: 0 } }), /CELL_CONFLICT/],
  ["foreign account", (c) => ({ ...c, scope: "other/w" }), /ACCESS_REVOKED/],
  ["wrong generation", (c) => ({ ...c, generation: 2 }), /GENERATION_CHANGED/],
  ["structure via patch", () => ({ ...patch(id, "bad"), patch: { date: to.date } }), /PATCH_FIELDS/],
];
for (const [name, mutate, error] of bad)
  test(`cells refuses ${name}`, (t) => {
    const e = setup(t),
      before = hash(snapshot(e.s));
    assert.throws(() => applyCommand(e.s, "u", mutate(move())), error);
    assert.equal(hash(snapshot(e.s)), before);
    assert.equal(state(e.s, scope).cursor, 0);
  });
test("cells new generation starts fresh structure/content counters", (t) => {
  const e = setup(t);
  applyCommand(e.s, "u", move());
  const all = snapshot(e.s).map((r) => [r.id, JSON.parse(r.body)]);
  restore(e.s, "u", scope, 1, "restore", all);
  assert.equal(contentVersion(e.s, scope, id), 1);
  assert.throws(
    () => accept(e.s, "u", operation(e.s, scope, id, record(e.s, scope, id).body)),
    /TYPED_ENTRY_REQUIRED/,
  );
  applyCommand(e.s, "u", { ...patch(id, "after restore"), generation: 2 });
  assert.equal(contentVersion(e.s, scope, id), 2);
});
async function kill(path, mode, payload, point) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [new URL("./cells-crash.mjs", import.meta.url).pathname, path, mode, payload, point],
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
for (const point of ["after-source", "after-target", "before-commit", "after-commit"])
  test(`cells server SIGKILL ${point}`, async (t) => {
    const e = setup(t),
      cmd = move(),
      payload = join(e.dir, "command.json"),
      before = hash(snapshot(e.s));
    writeFileSync(payload, JSON.stringify(cmd));
    e.s.close();
    await kill(join(e.dir, "server.db"), "move", payload, point);
    const s = e.db("server");
    assert.equal(s.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    const committed = point === "after-commit";
    assert.equal(state(s, scope).cursor, committed ? 1 : 0);
    assert.equal(record(s, scope, id).body.row.date, committed ? to.date : from.date);
    assert.equal(record(s, scope, child).body.row.date, committed ? to.date : from.date);
    if (!committed) assert.equal(hash(snapshot(s)), before);
    const ack = applyCommand(s, "u", cmd);
    assert.equal(ack.seq, 1);
    assert.equal(changes(s, scope, 0).length, 1);
  });
for (const point of ["after-row", "after-commit"])
  test(`cells receiver SIGKILL ${point}`, async (t) => {
    const e = setup(t),
      event = applyCommand(e.s, "u", move()),
      payload = join(e.dir, "event.json");
    writeFileSync(payload, JSON.stringify(event));
    e.a.close();
    await kill(join(e.dir, "a.db"), "receive", payload, point);
    const a = e.db("a"),
      committed = point === "after-commit";
    assert.equal(state(a, scope).cursor, committed ? 1 : 0);
    assert.equal(record(a, scope, id).body.row.date, committed ? to.date : from.date);
    assert.equal(record(a, scope, child).body.row.date, committed ? to.date : from.date);
    receiveBatches(a, scope, 1, [event]);
    assert.deepEqual(snapshot(a), snapshot(e.s));
  });

test("cells insert subtree before existing root without breaking target hierarchy", (t) => {
  const e = setup(t),
    target = { date: "2026-11-02", categoryId: "c2", version: 1 };
  applyCommand(e.s, "u", { ...move(), to: target, beforeId: rowId("entry_item", ["e5"]) });
  const rows = cellRows(e.s, scope, cellKey(target.date, target.categoryId));
  assert.deepEqual(
    rows.map((r) => r.body.row.id),
    ["e1", "e2", "e5", "e6", "e7", "e8"],
  );
  assert.deepEqual(
    rows.map((r) => r.body.row.depth),
    [0, 1, 0, 1, 0, 0],
  );
  assert.equal(cellVersion(e.s, scope, cellKey(target.date, target.categoryId)), 2);
});
test("cells refuses destination inside another parent children", (t) => {
  const e = setup(t),
    before = hash(snapshot(e.s));
  assert.throws(
    () =>
      applyCommand(e.s, "u", {
        ...move(),
        to: { date: "2026-11-02", categoryId: "c2", version: 1 },
        beforeId: rowId("entry_item", ["e6"]),
      }),
    /DESTINATION_REQUIRED/,
  );
  assert.equal(hash(snapshot(e.s)), before);
});
test("cells typed mode rejects legacy whole-row entry writes", (t) => {
  const e = setup(t);
  applyCommand(e.s, "u", move());
  const body = record(e.s, scope, id).body;
  body.row.date = "2026-11-09";
  assert.throws(() => accept(e.s, "u", operation(e.s, scope, id, body)), /TYPED_ENTRY_REQUIRED/);
  assert.equal(record(e.s, scope, id).body.row.date, to.date);
});

async function parallel(dir, commands) {
  return Promise.all(
    commands.map(
      (cmd, i) =>
        new Promise((resolve, reject) => {
          const payload = join(dir, `parallel-${i}.json`);
          writeFileSync(payload, JSON.stringify(cmd));
          const child = spawn(
            process.execPath,
            [new URL("./cells-race.mjs", import.meta.url).pathname, join(dir, "server.db"), payload],
            { stdio: ["ignore", "pipe", "pipe"] },
          );
          let out = "",
            err = "";
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(Error("parallel timeout"));
          }, 5000);
          child.stdout.on("data", (b) => {
            out += b;
          });
          child.stderr.on("data", (b) => {
            err += b;
          });
          child.on("error", reject);
          child.on("close", (code) => {
            clearTimeout(timer);
            if (code !== 0) reject(Error(err));
            else
              try {
                resolve(JSON.parse(out));
              } catch (e) {
                reject(e);
              }
          });
        }),
    ),
  );
}
test("cells independent patches from two server processes both commit", async (t) => {
  const e = setup(t);
  e.s.close();
  const outcomes = await parallel(e.dir, [patch(id, "process A", 1, "A"), patch(child, "process B", 1, "B")]);
  assert.ok(outcomes.every((r) => r.status === "accepted"));
  assert.deepEqual(outcomes.map((r) => r.seq).sort(), [1, 2]);
  const s = e.db("server");
  assert.equal(record(s, scope, id).body.row.text, "process A");
  assert.equal(record(s, scope, child).body.row.text, "process B");
});
test("cells competing moves from two server processes accept exactly one", async (t) => {
  const e = setup(t);
  e.s.close();
  const outcomes = await parallel(e.dir, [move("A"), move("B")]);
  assert.equal(outcomes.filter((r) => r.status === "accepted").length, 1);
  assert.equal(outcomes.find((r) => r.status === "rejected").code, "CELL_CONFLICT");
  const s = e.db("server");
  assert.equal(state(s, scope).cursor, 1);
  assert.equal(record(s, scope, id).body.row.date, to.date);
  assert.equal(record(s, scope, child).body.row.date, to.date);
});
