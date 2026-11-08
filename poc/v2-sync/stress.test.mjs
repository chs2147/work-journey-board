import { test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { mkdtempSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { largeFixture } from "./large-fixture.mjs";
import { convert18, verifyStage } from "./db18.mjs";
import { open, sourceHash } from "./model.mjs";
import { importStage, rowId } from "./stage-import.mjs";
import { createSnapshot, verifySnapshot } from "./recovery.mjs";
import { enqueuePatch, enqueueMoveAfter, integratedTick, integratedState } from "./integrated.mjs";
for (const [name, count, images, size] of [
  ["F1", 1000, 20, 0],
  ["F2", 100000, 200, 256 * 1024],
])
  test(`stress ${name}: source, staging, assets, snapshot and sync sample`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "wjb-v2-stress-"));
    writeFileSync(join(dir, ".v2-poc-only"), "synthetic stress only");
    const paths = { source: join(dir, "source.db"), stage: join(dir, "stage.db") },
      handles = [];
    t.after(() => {
      for (const d of handles)
        try {
          d.close();
        } catch {
          /* closed */
        }
      rmSync(dir, { recursive: true, force: true });
    });
    const start = performance.now();
    largeFixture(paths.source, { entries: count, images, blobBytes: size });
    const before = sourceHash(paths.source);
    const manifest = convert18(paths.source, paths.stage, "u/w");
    assert.equal(manifest.tables.entry_item.count, count);
    assert.equal(manifest.tables.note_asset.count + manifest.tables.cabi_asset.count, images);
    assert.equal(sourceHash(paths.source), before);
    const binary = Object.values(manifest.blobs).reduce((n, b) => n + b.bytes, 0);
    if (size) assert.equal(binary, 50 * 1024 * 1024);
    const s = open(join(dir, "server.db"));
    handles.push(s);
    importStage(s, paths.stage, "u/w");
    const snap = createSnapshot(s, "u/w");
    assert.equal(verifySnapshot(s, "u/w", snap.id).manifest.recordHash, snap.recordHash);
    if (name === "F1") {
      const a = open(join(dir, "client.db"));
      handles.push(a);
      importStage(a, paths.stage, "u/w");
      enqueuePatch(a, "u/w", rowId("entry_item", ["e1"]), { text: "large confirmed edit" });
      enqueueMoveAfter(a, "u/w", rowId("entry_item", ["e1"]), { date: "2026-11-20", categoryId: "c1" });
      for (let i = 0; i < 8 && integratedTick(a, s, "u", "u/w") === "sent"; i++) {
        /* drain */
      }
      assert.equal(integratedState(a, "u/w").typedJobs, 0);
      assert.equal(
        s
          .prepare(
            "SELECT count(*) n FROM records WHERE scope=? AND json_extract(body,'$.table')='entry_item'",
          )
          .get("u/w").n,
        count,
      );
    } else assert.equal(verifyStage(paths.stage, "u/w").manifest.sourceHash, before);
    t.diagnostic(
      JSON.stringify({
        case: name,
        entries: count,
        images,
        binaryBytes: binary,
        sourceBytes: statSync(paths.source).size,
        stageBytes: statSync(paths.stage).size,
        elapsedMs: Math.round(performance.now() - start),
        maxRSSKiB: process.resourceUsage().maxRSS,
        sourceHash: before,
        snapshotHash: snap.recordHash,
        status: "PASS",
        payload: "synthetic PNG-prefix bytes; storage/hash test, not image rendering",
      }),
    );
  });
