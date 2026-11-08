import { test } from "node:test";
import assert from "node:assert/strict";
import { env, drain, scope, root, child, board } from "./scenario.mjs";
import { record, working, changes, state, hash, accept, operation } from "./model.mjs";
import { rowId } from "./stage-import.mjs";
import { enqueueLifecycle, enqueuePatch, integratedTick, jobs } from "./integrated.mjs";
import { applyLifecycle, documentLinks, validateGraph, allRecords } from "./lifecycle.mjs";
function document(db) {
  const body = record(db, scope, board).body,
    doc = JSON.parse(body.row.doc);
  doc.boxes[0].content.content[0].content[0].text = "new board text";
  body.row.doc = JSON.stringify(doc);
  return { kind: "save-document", id: board, body, links: [{ boxId: "cb1", entryId: "e3" }] };
}
for (const n of [17, 41, 73]) {
  test(`lifecycle/${n}: delete subtree, links and replay are atomic`, (t) => {
    const e = env(t, n),
      cmd = enqueueLifecycle(e.a, scope, { kind: "delete-subtree", id: root });
    assert.equal(working(e.a, scope, root).row._pendingDelete, true);
    assert.equal(integratedTick(e.a, e.s, "u", scope, { loseAck: true }), "ack-lost");
    assert.equal(drain(e.a, e.s), "idle");
    drain(e.b, e.s);
    assert.equal(record(e.s, scope, root), null);
    assert.equal(record(e.s, scope, child), null);
    assert.equal(documentLinks(e.s, scope, board).length, 0);
    assert.equal(
      allRecords(e.s, scope).filter((r) =>
        ["note_entry_link", "cabi_entry_link", "cabinet_link"].includes(r.body.table),
      ).length,
      0,
    );
    assert.equal(record(e.s, scope, rowId("entry_item", ["e3"])).body.row.seq, 1);
    assert.equal(changes(e.s, scope, 0).length, 1);
    assert.equal(applyLifecycle(e.s, "u", cmd).seq, 1);
    validateGraph(e.a, scope);
    validateGraph(e.s, scope);
  });
  test(`lifecycle/${n}: child edit before deletion forces conflict`, (t) => {
    const e = env(t, n);
    enqueueLifecycle(e.a, scope, { kind: "delete-subtree", id: root });
    enqueuePatch(e.b, scope, child, { text: "child newer" });
    drain(e.b, e.s);
    assert.equal(drain(e.a, e.s), "conflict");
    assert.equal(record(e.s, scope, child).body.row.text, "child newer");
    assert.ok(record(e.s, scope, root));
  });
  test(`lifecycle/${n}: deletion before offline child edit preserves recovery copy`, (t) => {
    const e = env(t, n);
    enqueuePatch(e.a, scope, child, { text: "offline child" });
    enqueueLifecycle(e.b, scope, { kind: "delete-subtree", id: root });
    drain(e.b, e.s);
    assert.equal(drain(e.a, e.s), "conflict");
    assert.equal(record(e.s, scope, child), null);
    assert.equal(working(e.a, scope, child).row.text, "offline child");
    assert.equal(changes(e.s, scope, 0).length, 1);
  });
  test(`lifecycle/${n}: child creation invalidates old parent deletion`, (t) => {
    const e = env(t, n);
    enqueueLifecycle(e.a, scope, { kind: "delete-subtree", id: root });
    enqueueLifecycle(e.b, scope, { kind: "insert-child", id: root, newId: "child-new", text: "new child" });
    drain(e.b, e.s);
    assert.equal(drain(e.a, e.s), "conflict");
    assert.equal(record(e.s, scope, rowId("entry_item", ["child-new"])).body.row.depth, 1);
    validateGraph(e.s, scope);
  });
  test(`lifecycle/${n}: document JSON and authoritative links commit together`, (t) => {
    const e = env(t, n),
      cmd = enqueueLifecycle(e.a, scope, document(e.a));
    assert.equal(integratedTick(e.a, e.s, "u", scope, { loseAck: true }), "ack-lost");
    drain(e.a, e.s);
    drain(e.b, e.s);
    assert.equal(record(e.s, scope, board).body.row.doc, record(e.b, scope, board).body.row.doc);
    assert.deepEqual(
      documentLinks(e.s, scope, board).map((r) => r.body.row.entry_id),
      ["e3"],
    );
    assert.equal(changes(e.s, scope, 0).length, 1);
    assert.equal(applyLifecycle(e.s, "u", cmd).seq, 1);
    validateGraph(e.s, scope);
    assert.throws(
      () => accept(e.s, "u", operation(e.s, scope, board, record(e.s, scope, board).body)),
      /COMPOUND_DOCUMENT_REQUIRED/,
    );
  });
  test(`lifecycle/${n}: deleting link target blocks stale document save`, (t) => {
    const e = env(t, n),
      d = document(e.a);
    d.links = [{ boxId: "cb1", entryId: "e1" }];
    enqueueLifecycle(e.a, scope, d);
    enqueueLifecycle(e.b, scope, { kind: "delete-subtree", id: root });
    drain(e.b, e.s);
    assert.equal(drain(e.a, e.s), "conflict");
    assert.equal(record(e.s, scope, root), null);
    assert.equal(documentLinks(e.s, scope, board).length, 0);
  });
}
test("lifecycle invalid link and owner never partially publish", (t) => {
  const e = env(t),
    cmd = enqueueLifecycle(e.a, scope, document(e.a)),
    before = hash(allRecords(e.s, scope));
  for (const altered of [
    { ...cmd, links: [{ boxId: "missing", entryId: "e3" }] },
    { ...cmd, body: { ...cmd.body, row: { ...cmd.body.row, category_id: "c2" } } },
  ])
    assert.throws(() => applyLifecycle(e.s, "u", altered), /LINK_TARGET|DOCUMENT_OWNER/);
  assert.equal(hash(allRecords(e.s, scope)), before);
  assert.equal(state(e.s, scope).cursor, 0);
});
test("lifecycle transaction fault rolls back links and document, then succeeds", (t) => {
  const e = env(t),
    cmd = enqueueLifecycle(e.a, scope, document(e.a)),
    before = hash(allRecords(e.s, scope));
  assert.throws(
    () =>
      applyLifecycle(e.s, "u", cmd, (p) => {
        if (p === "after-links") throw Error("injected");
      }),
    /injected/,
  );
  assert.equal(hash(allRecords(e.s, scope)), before);
  assert.equal(state(e.s, scope).cursor, 0);
  applyLifecycle(e.s, "u", cmd);
  validateGraph(e.s, scope);
});
test("lifecycle deleted identifier cannot be reused for a new child", (t) => {
  const e = env(t);
  enqueueLifecycle(e.a, scope, { kind: "delete-subtree", id: root });
  drain(e.a, e.s);
  const id = rowId("entry_item", ["e3"]);
  const cmd = enqueueLifecycle(e.a, scope, {
    kind: "insert-child",
    id,
    newId: "e1",
    text: "forbidden resurrection",
  });
  assert.throws(() => applyLifecycle(e.s, "u", cmd), /ID_RETIRED_OR_USED/);
  assert.equal(record(e.s, scope, root), null);
  assert.equal(jobs(e.a, scope).at(-1).command.newId, "e1");
});
