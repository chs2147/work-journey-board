import { test } from "node:test";
import { URL } from "node:url";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout, clearTimeout } from "node:timers";
import {
  open,
  seed,
  record,
  state,
  operation,
  edit,
  pending,
  working,
  accept,
  changes,
  receive,
  restore,
  sourceHash,
} from "./model.mjs";
function env(t) {
  const dir = mkdtempSync(join(tmpdir(), "wjb-v2-poc-"));
  writeFileSync(join(dir, ".v2-poc-only"), "synthetic");
  const handles = [];
  t.after(() => {
    for (const db of handles)
      try {
        db.close();
      } catch {
        /* closed before restart */
      }
    rmSync(dir, { recursive: true, force: true });
  });
  const path = (n) => join(dir, `${n}.db`);
  const db = (n) => {
    const d = open(path(n));
    handles.push(d);
    return d;
  };
  return { dir, path, db };
}
async function crash(path, mode, point) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [new URL("./crash-worker.mjs", import.meta.url).pathname, path, mode, point],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let ready = false,
      err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("crash checkpoint timeout " + err));
    }, 5000);
    child.stderr.on("data", (b) => {
      err += b;
    });
    child.stdout.on("data", () => {
      ready = true;
      child.kill("SIGKILL");
    });
    child.on("error", reject);
    child.on("exit", (_code, signal) => {
      clearTimeout(timer);
      if (ready && signal === "SIGKILL") resolve();
      else reject(Error(err || "checkpoint not reached"));
    });
  });
}
for (const n of [17, 41, 73]) {
  test(`L01/${n}: synthetic source copy byte preservation and scope isolation`, (t) => {
    const e = env(t),
      src = e.db("source");
    seed(src, "u/w", [["x", { text: `원문 ${n}`, week: "2026-W45" }]]);
    src.close();
    const before = sourceHash(e.path("source"));
    copyFileSync(e.path("source"), e.path("copy"));
    const copy = e.db("copy");
    assert.deepEqual(record(copy, "u/w", "x").body, { text: `원문 ${n}`, week: "2026-W45" });
    edit(copy, operation(copy, "u/w", "x", { text: "copy edit" }));
    assert.equal(sourceHash(e.path("source")), before);
    assert.equal(record(copy, "u/other", "x"), null);
  });
  for (const mode of ["edit", "receive"])
    for (const point of [mode === "edit" ? "after-working" : "after-data", "after-commit"]) {
      test(`${mode === "edit" ? "L02" : "L04"}/${n}/${point}: SIGKILL and reopen file`, async (t) => {
        const e = env(t),
          d = e.db("local");
        seed(d, "u/w", [["x", { text: "before" }]]);
        d.close();
        await crash(e.path("local"), mode, point);
        const reopened = e.db("local"),
          committed = point === "after-commit";
        assert.equal(reopened.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
        if (mode === "edit") {
          assert.equal(working(reopened, "u/w", "x").text, committed ? "changed" : "before");
          assert.equal(pending(reopened, "u/w").length, committed ? 1 : 0);
        } else {
          assert.equal(record(reopened, "u/w", "x").body.text, committed ? "remote" : "before");
          assert.equal(state(reopened, "u/w").cursor, committed ? 1 : 0);
        }
      });
    }
  test(`L03/${n}: lost ack, duplicate request and subsequent editing`, (t) => {
    const e = env(t),
      a = e.db("a"),
      s = e.db("server");
    for (const d of [a, s]) seed(d, "u/w", [["x", { text: "old" }]]);
    const op = operation(a, "u/w", "x", { text: "first" }, `first-${n}`);
    edit(a, op);
    const ack = accept(s, "u", op);
    const later = operation(a, "u/w", "x", { text: "second" }, `second-${n}`);
    edit(a, later);
    assert.deepEqual(accept(s, "u", op), ack);
    assert.equal(changes(s, "u/w", 0).length, 1);
    assert.throws(() => accept(s, "u", { ...op, body: { text: "mutated" } }), /IDEMPOTENCY_KEY_REUSED/);
    receive(a, "u/w", 1, [ack]);
    assert.equal(working(a, "u/w", "x").text, "second");
    assert.equal(pending(a, "u/w").length, 1);
  });
  test(`L05/${n}: conflicting documents retained and stale resolution refused`, (t) => {
    const e = env(t),
      a = e.db("a"),
      s = e.db("s");
    for (const d of [a, s])
      seed(d, "u/w", [
        ["x", { text: "base" }],
        ["y", { text: "separate" }],
      ]);
    const mine = operation(a, "u/w", "x", { text: "mine" }, `mine-${n}`);
    edit(a, mine);
    const other = accept(s, "u", operation(s, "u/w", "x", { text: "theirs" }, `other-${n}`));
    receive(a, "u/w", 1, [other]);
    const conflict = JSON.parse(a.prepare("SELECT body FROM conflicts").get().body);
    assert.equal(conflict.base.body.text, "base");
    assert.equal(conflict.local.text, "mine");
    assert.equal(conflict.remote.body.text, "theirs");
    assert.throws(() => accept(s, "u", mine), /CONFLICT/);
    const resolution = operation(a, "u/w", "x", { text: "resolved" }, `resolve-${n}`);
    accept(s, "u", operation(s, "u/w", "x", { text: "third" }, `third-${n}`));
    assert.throws(() => accept(s, "u", resolution), /CONFLICT/);
    assert.equal(accept(s, "u", operation(s, "u/w", "y", { text: "independent" })).body.text, "independent");
  });
  test(`L06/${n}: stale structural aggregate cannot erase newer child`, (t) => {
    const e = env(t),
      s = e.db("s");
    seed(s, "u/w", [
      [
        "cell",
        {
          items: [
            { id: "parent", seq: 1, depth: 0 },
            { id: "child", seq: 2, depth: 1, text: "old" },
          ],
        },
      ],
    ]);
    const deletion = operation(s, "u/w", "cell", { items: [] }, `delete-${n}`);
    const update = operation(
      s,
      "u/w",
      "cell",
      {
        items: [
          { id: "parent", seq: 1, depth: 0 },
          { id: "child", seq: 2, depth: 1, text: "new" },
        ],
      },
      `child-${n}`,
    );
    accept(s, "u", update);
    assert.throws(() => accept(s, "u", deletion), /CONFLICT/);
    assert.equal(record(s, "u/w", "cell").body.items[1].text, "new");
  });
  test(`L07/${n}: idempotent restoration rejects old generation without dropping pending`, (t) => {
    const e = env(t),
      s = e.db("s"),
      a = e.db("a");
    for (const d of [s, a]) seed(d, "u/w", [["x", { text: "old" }]]);
    const stale = operation(a, "u/w", "x", { text: "offline" }, `old-${n}`);
    edit(a, stale);
    const snapshot = [["x", { text: "restored" }]];
    const result = restore(s, "u", "u/w", 1, `restore-${n}`, snapshot);
    assert.deepEqual(restore(s, "u", "u/w", 1, `restore-${n}`, snapshot), result);
    assert.equal(result.generation, 2);
    assert.throws(() => accept(s, "u", stale), /GENERATION_CHANGED/);
    assert.equal(pending(a, "u/w").length, 1);
  });
  test(`L08/${n}: delayed scope and foreign account rejected`, (t) => {
    const e = env(t),
      a = e.db("a"),
      s = e.db("s");
    seed(a, "u/other", [["x", { text: "other workspace" }]]);
    const op = {
      scope: "u/w",
      id: "x",
      base: 0,
      generation: 1,
      opId: `late-${n}`,
      body: { week: "2026-W45" },
    };
    const ack = accept(s, "u", op);
    assert.throws(() => accept(s, "intruder", op), /ACCESS_REVOKED/);
    assert.throws(() => receive(a, "u/other", 1, [ack]), /SCOPE_MISMATCH/);
    assert.equal(record(a, "u/other", "x").body.text, "other workspace");
    assert.equal(state(a, "u/other").cursor, 0);
  });
}
