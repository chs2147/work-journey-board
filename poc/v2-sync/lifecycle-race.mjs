import process from "node:process";
import { readFileSync, writeSync } from "node:fs";
import { open } from "./model.mjs";
import { applyLifecycle } from "./lifecycle.mjs";
import { applyCommand } from "./cells.mjs";
const [path, payload] = process.argv.slice(2);
let db;
try {
  db = open(path);
  const c = JSON.parse(readFileSync(payload, "utf8")),
    r = (["patch-entry", "move-subtree"].includes(c.kind) ? applyCommand : applyLifecycle)(db, "u", c);
  writeSync(1, JSON.stringify({ status: "accepted", seq: r.seq }));
} catch (e) {
  writeSync(1, JSON.stringify({ status: "rejected", code: e.message }));
} finally {
  db?.close();
}
