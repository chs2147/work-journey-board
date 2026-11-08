import process from "node:process";
import { writeSync } from "node:fs";
import { open, record } from "./model.mjs";
import { rowId } from "./stage-import.mjs";
import { enqueue, prepare } from "./queue.mjs";
const [path, point] = process.argv.slice(2),
  db = open(path),
  scope = "u/w",
  id = rowId("entry_item", ["e1"]);
const fault = (p) => {
  if (p === point) {
    writeSync(1, "READY\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
};
if (point === "after-freeze") prepare(db, scope, id, fault);
else {
  const body = record(db, scope, id).body;
  body.row.text = "child edit";
  enqueue(db, scope, id, body, fault);
}
