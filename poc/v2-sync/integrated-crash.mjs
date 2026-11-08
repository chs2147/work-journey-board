import process from "node:process";
import { writeSync } from "node:fs";
import { open } from "./model.mjs";
import { rowId } from "./stage-import.mjs";
import { enqueueMove, enqueuePatch, freezePatches, integratedTick } from "./integrated.mjs";
const [aPath, sPath, mode, point] = process.argv.slice(2),
  a = open(aPath),
  s = open(sPath),
  scope = "u/w",
  id = rowId("entry_item", ["e1"]);
const fault = (p) => {
  if (p === point) {
    writeSync(1, "READY\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
};
if (mode === "move") enqueueMove(a, scope, id, { date: "2026-11-03", categoryId: "c1" }, null, fault);
else if (mode === "freeze") {
  enqueuePatch(a, scope, id, { text: "frozen edit" });
  freezePatches(a, scope, fault);
} else integratedTick(a, s, "u", scope, { fault });
