import process from "node:process";
import { readFileSync, writeSync } from "node:fs";
import { open } from "./model.mjs";
import { applyLifecycle } from "./lifecycle.mjs";
import { restoreSnapshot } from "./recovery.mjs";
import { integratedTick } from "./integrated.mjs";
const [serverPath, clientPath, mode, payloadPath, point] = process.argv.slice(2),
  s = open(serverPath),
  payload = JSON.parse(readFileSync(payloadPath, "utf8"));
const fault = (p) => {
  if (p === point) {
    writeSync(1, "READY\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
};
if (mode === "lifecycle") applyLifecycle(s, "u", payload, fault);
else if (mode === "restore") restoreSnapshot(s, "u", "u/w", 1, "restore", payload.snapshot, fault);
else {
  const a = open(clientPath);
  integratedTick(a, s, "u", "u/w", { fault });
}
