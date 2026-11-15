// Local synthetic DB only; stdin/URL/credentials are never accepted.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createConnectedCopy } from "../v2-assets/connected-copy.mjs";
import { mapWorkspace } from "./workspace-map.mjs";
import { buildSourceFixture } from "./source-fixture.mjs";
const version = Number(process.argv[2]);
if (![18, 19, 20].includes(version)) throw Error("FIXTURE_VERSION");
// 선택: 큰 일지 흉내(가상 업무 항목 N개 추가, C-1 페이지 업로드 시험용) — 기존 항목 1개를 새 ID·날짜로 복제
const extraItems = process.argv[3] === "--extra-items" ? Number(process.argv[4]) : 0;
if (!Number.isInteger(extraItems) || extraItems < 0 || extraItems > 30000) throw Error("FIXTURE_EXTRA_ITEMS");
const dir = mkdtempSync(join(tmpdir(), "wjb-workspace-sql-"));
try {
  for (const n of ["source", "target"]) {
    mkdirSync(join(dir, n));
    writeFileSync(join(dir, n, ".v2-poc-only"), "synthetic");
  }
  const source = join(dir, "source", "source.db");
  buildSourceFixture(source, version, extraItems);
  const destination = join(dir, "target", "copy"),
    workspaceId = randomUUID();
  createConnectedCopy(source, destination, { workspaceId, sourceWorkspaceId: randomUUID() });
  process.stdout.write(JSON.stringify(mapWorkspace(destination, workspaceId).envelope));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
