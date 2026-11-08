import process from "node:process";
import console from "node:console";
import { URL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash } from "./model.mjs";
const here = new URL("./", import.meta.url),
  root = new URL("../../", here),
  output = mkdtempSync(join(tmpdir(), "wjb-v2-local-evidence-"));
const suites = [];
for (const [file, expected] of [
  ["model.test.mjs", 30],
  ["db18.test.mjs", 19],
  ["queue.test.mjs", 28],
  ["cells.test.mjs", 38],
  ["integrated.test.mjs", 37],
]) {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL(file, here))], {
    encoding: "utf8",
    cwd: fileURLToPath(root),
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const log = (run.stdout ?? "") + (run.stderr ?? "");
  writeFileSync(join(output, file + ".log"), log);
  const count = Number(log.match(/(?:ℹ|#) tests (\d+)/)?.[1]),
    failures = Number(log.match(/(?:ℹ|#) fail (\d+)/)?.[1]);
  suites.push({
    file,
    expected,
    count,
    failures,
    exitCode: run.status,
    spawnError: run.error?.code ?? null,
    signal: run.signal,
    logHash: hash(log),
    status:
      !run.error && !run.signal && run.status === 0 && count === expected && failures === 0 ? "PASS" : "FAIL",
    cases: log.split("\n").filter((l) => /^[✔✖]/u.test(l)),
    fixtures: log
      .split("\n")
      .filter((l) => l.includes('"case":"DB18/'))
      .map((l) => JSON.parse(l.slice(l.indexOf("{")))),
  });
}
const evidence = {
  runId: new Date().toISOString(),
  target: "LOCAL_MODEL_ONLY",
  runtime: process.version,
  platform: process.platform,
  arch: process.arch,
  status: suites.every((s) => s.status === "PASS") ? "PASS" : "FAIL",
  suites,
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
writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log(
  JSON.stringify({
    output,
    status: evidence.status,
    suites: suites.map((s) => ({ file: s.file, count: s.count, status: s.status })),
  }),
);
if (evidence.status !== "PASS") process.exitCode = 1;
