// Local synthetic DB only; stdin/URL/credentials are never accepted.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { enrich } from "./fixture-full-workspace.mjs";
import { upgradeFixture } from "./fixture-db20.mjs";
import { fixture18 } from "../v2-sync/fixture18.mjs";
import { createConnectedCopy } from "../v2-assets/connected-copy.mjs";
import { mapWorkspace } from "./workspace-map.mjs";
const version = Number(process.argv[2]);
if (![18, 19, 20].includes(version)) throw Error("FIXTURE_VERSION");
const dir = mkdtempSync(join(tmpdir(), "wjb-workspace-sql-"));
try {
  for (const n of ["source", "target"]) {
    mkdirSync(join(dir, n));
    writeFileSync(join(dir, n, ".v2-poc-only"), "synthetic");
  }
  const source = join(dir, "source", "source.db");
  fixture18(source);
  const enriched = new DatabaseSync(source);
  try {
    enrich(enriched);
  } finally {
    enriched.close();
  }
  if (version >= 19) {
    const db = new DatabaseSync(source);
    try {
      upgradeFixture(db, version);
    } finally {
      db.close();
    }
  }
  const destination = join(dir, "target", "copy"),
    workspaceId = randomUUID();
  createConnectedCopy(source, destination, { workspaceId, sourceWorkspaceId: randomUUID() });
  process.stdout.write(JSON.stringify(mapWorkspace(destination, workspaceId).envelope));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
