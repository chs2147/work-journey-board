import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertSeparateWorkspacePaths,
  resolveIsolationProfile,
  assertProfileSeparation,
  assertReleasePublication,
  openWorkspaceRuntime,
} from "./isolation.mjs";

const verifiedReceipt = {
  status: "verified",
  workspaceId: "00000000-0000-4000-8000-000000000001",
  manifestHash: "a".repeat(64),
  generation: "1",
};
const migration = {
  workspaceId: verifiedReceipt.workspaceId,
  manifestHash: verifiedReceipt.manifestHash,
  verifyMigration: async () => verifiedReceipt,
};

for (const [platform, localDataBase] of [
  ["win32", "C:\\Users\\fixture\\AppData\\Local"],
  ["darwin", "/Users/fixture/Library/Application Support"],
  ["linux", "/tmp/fixture-data"],
]) {
  test(`${platform}: separate app/config/update/credentials/IPC/instance namespaces`, () => {
    const local = resolveIsolationProfile({ profile: "local-classic", platform, localDataBase });
    const connected = resolveIsolationProfile({ profile: "connected-preview", platform, localDataBase });
    assertProfileSeparation(local, connected);
    assert.equal(connected.updaterEnabled, false);
    assert.equal(connected.releaseRepository, null);
    assert.equal(connected.fileAssociationRegistration, "disabled");
    assert.throws(
      () => assertProfileSeparation(local, { ...connected, configRoot: local.configRoot }),
      /PATH_OVERLAP/,
    );
  });
}
test("observed legacy identifier/config folder/release feed match actual sources", () => {
  const config = JSON.parse(
    readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  const files = readFileSync(new URL("../../src-tauri/src/files.rs", import.meta.url), "utf8");
  const update = readFileSync(new URL("../../src-tauri/src/update.rs", import.meta.url), "utf8");
  const local = resolveIsolationProfile({
    profile: "local-classic",
    platform: "win32",
    localDataBase: "C:\\Fixture",
  });
  assert.equal(local.appId, config.identifier);
  assert.ok(files.includes(`const CONFIG_DIR: &str = "${local.configDirectory}"`));
  assert.ok(update.includes(`https://api.github.com/repos/${local.releaseRepository}/releases?per_page=10`));
});
for (const [platform, source, destination] of [
  ["linux", "/tmp/local", "/tmp/local/online"],
  ["linux", "/tmp/local", "/tmp"],
  ["linux", "/tmp/local", "/tmp/local"],
  ["linux", "/tmp/local", "/tmp/other/../local/copy"],
  ["win32", "C:\\Data\\Local", "c:\\DATA\\LOCAL\\Online"],
  ["darwin", "/Users/fixture/Local", "/users/fixture/local/Online"],
]) {
  test(`${platform}: reject equal/ancestor/nested source destination ${destination}`, () =>
    assert.throws(() => assertSeparateWorkspacePaths(platform, source, destination), /PATH_OVERLAP/));
}
test("a sibling sharing a name prefix is allowed", () =>
  assert.doesNotThrow(() => assertSeparateWorkspacePaths("linux", "/tmp/local", "/tmp/local-online")));
test("different Windows volumes are separate", () =>
  assert.doesNotThrow(() => assertSeparateWorkspacePaths("win32", "C:\\Local", "D:\\Online")));
test("explicit platform/profile and absolute trusted roots required", () => {
  assert.throws(() => resolveIsolationProfile({ platform: "linux", localDataBase: "/tmp" }), /PROFILE/);
  assert.throws(
    () => resolveIsolationProfile({ profile: "local-classic", platform: "unknown", localDataBase: "/tmp" }),
    /PLATFORM/,
  );
  assert.throws(
    () => resolveIsolationProfile({ profile: "local-classic", platform: "linux", localDataBase: "relative" }),
    /ABSOLUTE/,
  );
});
test("Windows device paths/alternate streams are not valid roots", () => {
  for (const root of ["\\\\?\\C:\\Data", "C:\\Data:stream"])
    assert.throws(
      () => resolveIsolationProfile({ profile: "connected-preview", platform: "win32", localDataBase: root }),
      /WINDOWS_PATH/,
    );
});
test("Windows trailing-dot/space aliases cannot bypass root separation", () => {
  for (const path of ["C:\\Data\\Local.\\Online", "C:\\Data\\Local \\Online"])
    assert.throws(
      () => assertSeparateWorkspacePaths("win32", "C:\\Data\\Local", path),
      /UNSUPPORTED_WINDOWS_PATH/,
    );
});
test("macOS Unicode normalization aliases cannot bypass root separation", () => {
  assert.throws(
    () => assertSeparateWorkspacePaths("darwin", "/Users/fixture/Café", "/Users/fixture/Cafe\u0301/Online"),
    /PATH_OVERLAP/,
  );
});
test("identity collision is rejected even when config path differs", () => {
  const config = { platform: "linux", localDataBase: "/tmp/data" };
  const a = resolveIsolationProfile({ ...config, profile: "local-classic" }),
    b = resolveIsolationProfile({ ...config, profile: "connected-preview" });
  assert.throws(() => assertProfileSeparation(a, { ...b, appId: a.appId }), /NAMESPACE_COLLISION/);
});
test("connected release cannot share existing local feed, even for RC tags", () =>
  assert.throws(
    () =>
      assertReleasePublication({ profile: "connected-preview", repository: "chs2147/work-journey-board" }),
    /LEGACY_RELEASE_FEED_FORBIDDEN/,
  ));
test("connected publication stays disabled before an approved channel exists", () =>
  assert.throws(
    () => assertReleasePublication({ profile: "connected-preview", repository: "fictional/new-feed" }),
    /CHANNEL_NOT_CONFIGURED/,
  ));
test("legacy release stays on existing repository", () => {
  assertReleasePublication({ profile: "local-classic", repository: "chs2147/work-journey-board" });
  assert.throws(
    () => assertReleasePublication({ profile: "local-classic", repository: "other/repo" }),
    /REPOSITORY_MISMATCH/,
  );
});
for (const profile of ["local-classic", "connected-preview"]) {
  test(`${profile}: local workspace opens without cloud factory or credentials`, async () => {
    let calls = 0;
    const result = await openWorkspaceRuntime({
      profile,
      mode: "local",
      format: "legacy-db18",
      createLocal: () => ({ local: true }),
      createConnected: () => {
        calls++;
        throw Error("No credentials");
      },
    });
    assert.equal(result.local, true);
    assert.equal(calls, 0);
  });
}
test("online-capable profile does not auto-convert a local DB based on login", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      openWorkspaceRuntime({
        profile: "connected-preview",
        mode: "connected",
        format: "legacy-db18",
        createConnected: () => {
          calls++;
        },
      }),
    /CONNECTED_FORMAT_REQUIRED/,
  );
  assert.equal(calls, 0);
});
test("classic local profile cannot initialize connected adapter", async () => {
  await assert.rejects(
    () =>
      openWorkspaceRuntime({
        profile: "local-classic",
        mode: "connected",
        format: "connected-metadata",
        createConnected: () => {
          throw Error("unexpected");
        },
      }),
    /CONNECTED_PROFILE_REQUIRED/,
  );
});
test("connected adapter failures never silently fall back to a legacy original", async () => {
  let localCalls = 0;
  await assert.rejects(
    () =>
      openWorkspaceRuntime({
        ...migration,
        profile: "connected-preview",
        mode: "connected",
        format: "connected-metadata",
        createConnected: () => {
          throw Error("AUTH_UNAVAILABLE");
        },
        createLocal: () => {
          localCalls++;
        },
      }),
    /AUTH_UNAVAILABLE/,
  );
  assert.equal(localCalls, 0);
});
test("unsupported local format cannot invoke local repository", async () => {
  let called = false;
  await assert.rejects(
    () =>
      openWorkspaceRuntime({
        profile: "connected-preview",
        mode: "local",
        format: "connected-metadata",
        createLocal: () => {
          called = true;
        },
      }),
    /LOCAL_FORMAT_REQUIRED/,
  );
  assert.equal(called, false);
});
test("local extraction READY cannot substitute for a verified server receipt", async () => {
  for (const receipt of [
    true,
    { status: "local-extracted-not-uploaded" },
    { ...verifiedReceipt, manifestHash: "b".repeat(64) },
    { ...verifiedReceipt, workspaceId: "00000000-0000-4000-8000-000000000002" },
  ]) {
    let connected = false;
    await assert.rejects(
      () =>
        openWorkspaceRuntime({
          ...migration,
          profile: "connected-preview",
          mode: "connected",
          format: "connected-metadata",
          verifyMigration: async () => receipt,
          createConnected: () => {
            connected = true;
          },
        }),
      /MIGRATION_NOT_VERIFIED/,
    );
    assert.equal(connected, false);
  }
});
test("missing authoritative receipt adapter blocks connected initialization", async () => {
  await assert.rejects(
    () =>
      openWorkspaceRuntime({
        profile: "connected-preview",
        mode: "connected",
        format: "connected-metadata",
        createConnected: () => {
          throw Error("unexpected");
        },
      }),
    /RECEIPT_REQUIRED/,
  );
});
test("verified exact workspace and manifest can initialize only the connected factory", async () => {
  let local = false;
  const value = await openWorkspaceRuntime({
    ...migration,
    profile: "connected-preview",
    mode: "connected",
    format: "connected-metadata",
    createLocal: () => {
      local = true;
    },
    createConnected: ({ receipt }) => ({ generation: receipt.generation }),
  });
  assert.deepEqual(value, { generation: "1" });
  assert.equal(local, false);
});
