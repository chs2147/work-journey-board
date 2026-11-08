import process from "node:process";
import console from "node:console";
import { URL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash } from "./model.mjs";
const here = new URL("./", import.meta.url),
  root = new URL("../../", here);
const output = mkdtempSync(join(tmpdir(), "wjb-v2-db18-evidence-"));
const run = spawnSync(process.execPath, [fileURLToPath(new URL("db18.test.mjs", here))], {
  encoding: "utf8",
  cwd: fileURLToPath(root),
  timeout: 30000,
});
const log = (run.stdout ?? "") + (run.stderr ?? "");
const cases = log
  .split("\n")
  .filter((l) => l.includes('"case":"DB18/'))
  .map((l) => JSON.parse(l.slice(l.indexOf("{"))));
const tests = Number(log.match(/(?:ℹ|#) tests (\d+)/)?.[1]),
  failures = Number(log.match(/(?:ℹ|#) fail (\d+)/)?.[1]);
const evidence = {
  runId: new Date().toISOString(),
  target: "LOCAL_MODEL_DB18_STAGING",
  runtime: process.version,
  platform: process.platform,
  arch: process.arch,
  tests,
  failures,
  spawnError: run.error?.code ?? null,
  signal: run.signal,
  status:
    !run.error && !run.signal && run.status === 0 && tests === 19 && failures === 0 && cases.length === 3
      ? "PASS"
      : "FAIL",
  fixtureCases: cases,
  codeHashes: Object.fromEntries(
    readdirSync(here)
      .filter((f) => f.endsWith(".mjs"))
      .sort()
      .map((f) => [f, hash(readFileSync(new URL(f, here)))]),
  ),
  migrationHashes: Object.fromEntries(
    readdirSync(new URL("../../src/data/migrations/", here))
      .filter((f) => /^00\d\d_.*\.sql$/.test(f) && Number(f.slice(0, 4)) <= 18)
      .sort()
      .map((f) => [f, hash(readFileSync(new URL("../../src/data/migrations/" + f, here)))]),
  ),
};
writeFileSync(join(output, "tests.log"), log);
writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ output, tests, failures, status: evidence.status }));
if (evidence.status !== "PASS") process.exitCode = 1;
