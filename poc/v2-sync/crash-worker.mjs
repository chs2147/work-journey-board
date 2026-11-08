import process from "node:process";
import { writeSync } from "node:fs";
import { open, edit, operation, receive } from "./model.mjs";
const [path, mode, point] = process.argv.slice(2);
const db = open(path);
const stop = (p) => {
  if (p === point) {
    writeSync(1, "READY\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
};
if (mode === "edit") edit(db, operation(db, "u/w", "x", { text: "changed" }, "crash-op"), stop);
else
  receive(
    db,
    "u/w",
    1,
    [{ scope: "u/w", generation: 1, id: "x", body: { text: "remote" }, rev: 2, seq: 1, opId: "remote" }],
    stop,
  );
