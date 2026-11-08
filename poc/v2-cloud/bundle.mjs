import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import console from "node:console";
const repo = new URL("../../", import.meta.url),
  destination = new URL("./bundle/", import.meta.url);
export const sources = [
  "poc/v2-cloud/session-guard.sql",
  "poc/v2-gateway/postgres-metadata.sql",
  "poc/v2-gateway/recovery.sql",
];
export const templates = ["rollback", "pause", "resume", "verify", "preinstall"];
const sha = (text) => createHash("sha256").update(text).digest("hex");
export function stripTransaction(text) {
  const match = text.match(/^((?:\s|--[^\n]*(?:\n|$))*)BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/);
  if (!match || /(?:^|\n)\s*(?:BEGIN|COMMIT|ROLLBACK);\s*(?:\n|$)/.test(match[2]))
    throw new Error("Unsupported source transaction shape");
  return match[1] + match[2];
}
export function renderBundle(read = (path) => readFileSync(new URL(path, repo), "utf8")) {
  const sqlSources = sources.map((path) => ({ path, text: read(path) }));
  const install =
    "-- GENERATED REVIEW CANDIDATE. No automatic execution. All modules commit together.\nBEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='30s';\n" +
    sqlSources.map((s) => "\n-- SOURCE " + s.path + "\n" + stripTransaction(s.text)).join("\n") +
    "\nCOMMIT;\n";
  const artifacts = { "install.sql": install };
  for (const name of templates) artifacts[name + ".sql"] = read("poc/v2-cloud/templates/" + name + ".sql");
  const plan = JSON.parse(read("poc/v2-cloud/plan.json"));
  const manifest = {
    ...plan,
    planVersion: 2,
    scope: "review-candidate-not-deployed",
    generatorSha256: sha(read("poc/v2-cloud/bundle.mjs")),
    metadataSchema: "wjb_gateway",
    sources: sqlSources.map((s) => ({ path: s.path, sha256: sha(s.text) })),
    templates: templates.map((name) => ({
      path: "poc/v2-cloud/templates/" + name + ".sql",
      sha256: sha(artifacts[name + ".sql"]),
    })),
    objects: {
      schemas: ["wjb_v2_cloud", "wjb_gateway"],
      tables: [
        "wjb_v2_cloud.blocked_session",
        "wjb_gateway.workspace",
        "wjb_gateway.device",
        "wjb_gateway.asset",
        "wjb_gateway.io_intent",
        "wjb_gateway.recovery_audit",
      ],
      publicFunctions: [
        "wjb_v2_session_active(uuid,uuid)",
        "wjb_v2_revoke_session(uuid,uuid)",
        "wjb_v2_asset_command(jsonb)",
        "wjb_v2_recovery_catalog(jsonb)",
      ],
      privateFunctions: [
        "wjb_v2_cloud.session_active(uuid,uuid)",
        "wjb_v2_cloud.revoke_session(uuid,uuid)",
        "wjb_gateway.asset_json(wjb_gateway.asset)",
      ],
    },
    expectedVerification: {
      schemaCount: 2,
      tableCount: 6,
      rlsEnabledCount: 6,
      functionCount: 7,
      publicRpcCount: 4,
      unsafeSearchPaths: 0,
      clientExecutableCount: 0,
      publicExecutableCount: 0,
      servicePublicExecutableCount: 4,
      serviceDirectTableAccessCount: 0,
    },
    ownerModel: "reviewed-migration-executor-not-yet-approved",
    rollbackMode: "empty-only",
    phases: [
      { id: "sql-install", excludes: ["bucket", "runtime", "auth-users", "data-migration"] },
      { id: "cloud-validation", requires: ["sql-install", "private-storage", "gateway", "org-usage"] },
    ],
    autoApply: false,
    artifactSha256: Object.fromEntries(Object.entries(artifacts).map(([name, text]) => [name, sha(text)])),
  };
  artifacts["manifest.json"] = JSON.stringify(manifest, null, 2) + "\n";
  return artifacts;
}
export function checkBundle({
  readGenerated = (name) => readFileSync(new URL(name, destination), "utf8"),
  listGenerated = () => readdirSync(destination),
} = {}) {
  const expected = renderBundle();
  const extra = listGenerated().filter(
    (name) => /\.(sql|json)$/.test(name) && !Object.hasOwn(expected, name),
  );
  if (extra.length) throw new Error("Unexpected bundle files: " + extra.join(","));
  for (const [name, text] of Object.entries(expected))
    if (readGenerated(name) !== text) throw new Error("Bundle is stale: " + name);
  return true;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2] || "check";
    if (mode === "build") {
      mkdirSync(destination, { recursive: true });
      for (const [name, text] of Object.entries(renderBundle()))
        writeFileSync(new URL(name, destination), text);
      console.log("Review bundle generated; no SQL executed.");
    } else if (mode === "check") {
      checkBundle();
      console.log("Review bundle sources and generated files match.");
    } else throw new Error("Use build or check");
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
