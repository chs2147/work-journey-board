import process from "node:process";
import { readFileSync, writeSync } from "node:fs";
import { open } from "./model.mjs";
import { applyCommand } from "./cells.mjs";
const [path, payload] = process.argv.slice(2);
let db;
try {
  db = open(path);
  const result = applyCommand(db, "u", JSON.parse(readFileSync(payload, "utf8")));
  writeSync(1, JSON.stringify({ status: "accepted", seq: result.seq }));
} catch (e) {
  writeSync(1, JSON.stringify({ status: "rejected", code: e.message }));
} finally {
  db?.close();
}
