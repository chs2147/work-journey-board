import process from "node:process";
import { readFileSync, writeSync } from "node:fs";
import { open } from "./model.mjs";
import { applyCommand, receiveBatches } from "./cells.mjs";
const [path, mode, payloadPath, point] = process.argv.slice(2),
  db = open(path),
  payload = JSON.parse(readFileSync(payloadPath, "utf8"));
const stop = (p) => {
  if (p === point) {
    writeSync(1, "READY\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
};
if (mode === "move") applyCommand(db, "u", payload, stop);
else receiveBatches(db, "u/w", 1, [payload], stop);
