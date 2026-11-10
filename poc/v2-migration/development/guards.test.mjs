import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const clean = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith("WJB_") && !k.startsWith("SUPABASE_")),
);
const dev = { ...clean, WJB_CLOUD_ENV: "development", WJB_SUPABASE_DEV_PROJECT_REF: "vsphftnmfzfoufasjttd" };
const live = new URL("./live-check.mjs", import.meta.url),
  inspect = new URL("./inspect.mjs", import.meta.url);
for (const [name, file, args, env, code] of [
  ["live requires explicit invocation", live, [], dev, "EXPLICIT_DEV_FIXTURE_REQUIRED"],
  [
    "live refuses production selection",
    live,
    ["--run-development-fixtures", "--free-usage-confirmed"],
    { ...dev, WJB_CLOUD_ENV: "production" },
    "EXPLICIT_DEV_FIXTURE_REQUIRED",
  ],
  [
    "live needs DEV credentials before requests",
    live,
    ["--run-development-fixtures", "--free-usage-confirmed"],
    dev,
    "DEV_CREDENTIALS_REQUIRED",
  ],
  ["inspect requires explicit invocation", inspect, [], dev, "EXPLICIT_DEV_INSPECTION_REQUIRED"],
  [
    "inspect refuses production selection",
    inspect,
    ["--inspect-development"],
    { ...dev, WJB_CLOUD_ENV: "production" },
    "DEV_REQUIRED",
  ],
  [
    "inspect needs DEV credentials before requests",
    inspect,
    ["--inspect-development"],
    dev,
    "DEV_KEYS_REQUIRED",
  ],
])
  test(name, () => {
    const result = spawnSync(process.execPath, [file.pathname, ...args], {
      env,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(code));
  });
