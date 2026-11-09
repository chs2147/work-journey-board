import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import console from "node:console";
import { checkBundle, stripTransaction } from "../bundle.mjs";
const base = new URL("../bundle/", import.meta.url),
  out = new URL("./bundle/", import.meta.url);
const dev = "vsphftnmfzfoufasjttd",
  prod = "hutqsfftioxtredcjhsy";
const sha = (s) => createHash("sha256").update(s).digest("hex");
export function renderDevelopment() {
  checkBundle();
  const read = (n) => readFileSync(new URL(n, base), "utf8");
  const keep = readFileSync(new URL("./keepalive.sql", import.meta.url), "utf8");
  const verifyKeep = readFileSync(new URL("./keepalive-verify.sql", import.meta.url), "utf8");
  const files = {
    "install.sql":
      "-- GENERATED DEVELOPMENT ONLY; manual authorized application.\nBEGIN;\n" +
      stripTransaction(read("install.sql")) +
      "\n" +
      stripTransaction(keep) +
      "\nCOMMIT;\n",
  };
  for (const name of ["rollback.sql", "pause.sql", "resume.sql", "verify.sql", "preinstall.sql"]) {
    const s = read(name);
    files[name] = s.replaceAll(prod, dev);
  }
  files["keepalive-verify.sql"] = verifyKeep;
  const original = JSON.parse(read("manifest.json"));
  const manifest = {
    profile: "development",
    projectRef: dev,
    region: "ap-northeast-2",
    autoApply: false,
    monthlyBudgetKRW: 0,
    baseManifestSha256: sha(read("manifest.json")),
    baseSources: original.sources,
    baseTemplates: original.templates,
    expectedVerification: original.expectedVerification,
    keepalive: {
      name: "keepalive_ping",
      scheduleUTC: "0 3 * * *",
      scheduleKST: "daily 12:00",
      singletonTable: "public.keepalive_pings",
      logRetentionDays: 14,
      sourceSha256: sha(keep),
    },
    rollbackScope: "module empty-only uninstall leaves heartbeat; do not drop pg_cron",
    generatorSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    artifacts: Object.fromEntries(Object.entries(files).map(([n, s]) => [n, sha(s)])),
  };
  files["manifest.json"] = JSON.stringify(manifest, null, 2) + "\n";
  return files;
}
export function checkDevelopment() {
  const files = renderDevelopment();
  if (readdirSync(out).some((n) => !Object.hasOwn(files, n)))
    throw new Error("Unexpected development artifact");
  for (const [n, s] of Object.entries(files))
    if (readFileSync(new URL(n, out), "utf8") !== s) throw new Error("Stale development artifact: " + n);
  return true;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "build") {
      mkdirSync(out, { recursive: true });
      for (const [n, s] of Object.entries(renderDevelopment())) writeFileSync(new URL(n, out), s);
      console.log("Development bundle generated; SQL not executed.");
    } else {
      checkDevelopment();
      console.log("Development bundle hashes match.");
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
