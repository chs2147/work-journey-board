import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open } from "./model.mjs";
import { fixture18 } from "./fixture18.mjs";
import { convert18 } from "./db18.mjs";
import { importStage, rowId } from "./stage-import.mjs";
import { integratedTick } from "./integrated.mjs";
export const scope = "u/w",
  root = rowId("entry_item", ["e1"]),
  child = rowId("entry_item", ["e2"]),
  board = rowId("cabi_board", ["b1"]);
export function env(t, n = 17) {
  const dir = mkdtempSync(join(tmpdir(), "wjb-v2-scenario-"));
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
  const a = db("a"),
    b = db("b"),
    s = db("server");
  for (const d of [a, b, s]) importStage(d, stage, scope);
  t.after(() => {
    for (const d of handles)
      try {
        d.close();
      } catch {
        /* closed for worker */
      }
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, source, stage, a, b, s, db };
}
export function drain(a, s) {
  for (let i = 0; i < 30; i++) {
    const result = integratedTick(a, s, "u", scope);
    if (result !== "sent") return result;
  }
  throw Error("QUEUE_DID_NOT_SETTLE");
}
