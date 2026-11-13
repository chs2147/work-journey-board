import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveIsolationProfile, assertProfileSeparation, assertReleasePublication } from "./isolation.mjs";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
test("shared Classic profile matches actual Tauri identity and Classic config folder constant", () => {
  const t = JSON.parse(read("../../src-tauri/tauri.conf.json"));
  const p = resolveIsolationProfile({
    profile: "local-classic",
    platform: "linux",
    localDataBase: "/synthetic",
  });
  assert.equal(p.appId, t.identifier);
  assert.equal(p.productName, t.productName);
  const dir = read("../../src-tauri/src/profile.rs").match(
    /pub const CLASSIC_CONFIG_DIR: &str = "([^"]+)"/,
  )[1];
  assert.equal(p.configRoot, "/synthetic/" + dir);
  assert(
    read("../../src-tauri/src/update.rs").includes(
      "https://api.github.com/repos/" + p.releaseRepository + "/releases",
    ),
  );
});
test("approved Preview definition is separate but cannot publish to the Classic channel", () => {
  const classic = resolveIsolationProfile({
      profile: "local-classic",
      platform: "linux",
      localDataBase: "/synthetic",
    }),
    preview = resolveIsolationProfile({
      profile: "connected-preview",
      platform: "linux",
      localDataBase: "/synthetic",
    });
  assert.doesNotThrow(() => assertProfileSeparation(classic, preview));
  assert.equal(preview.appId, "com.chs2147.workjourneyboard.connected.preview");
  assert.equal(preview.configRoot, "/synthetic/WorkJourneyBoardConnectedPreview");
  assert.equal(preview.updaterEnabled, false);
  assert.equal(preview.fileAssociationRegistration, "disabled");
  assert.throws(
    () => assertReleasePublication({ profile: "connected-preview", repository: classic.releaseRepository }),
    /LEGACY_RELEASE_FEED_FORBIDDEN/,
  );
});
test("Rust and Node consume the same checked-in profile manifest", () => {
  const source = read("../v2-native/src/policy.rs");
  assert(source.includes('include_str!("../profiles.tsv")'));
  const manifest = read("../v2-native/profiles.tsv");
  assert.equal(manifest.trimEnd().split("\n").length, 3);
  for (const profile of ["local-classic", "connected-preview"]) assert(manifest.includes(profile + "|"));
});
