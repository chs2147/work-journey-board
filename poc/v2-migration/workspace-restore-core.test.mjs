// 원본 → 온라인 형식 → 되살림(메모리 일지) 왕복 — DB18·19·20 가상 일지(실제 업무 기록 아님)
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { DatabaseSync } from "node:sqlite";
import { createCopyCore } from "../v2-assets/copy-core.mjs";
import { createWorkspaceMapper } from "./workspace-map-core.mjs";
import { createWorkspaceRestorer } from "./workspace-restore-core.mjs";
import { buildSourceFixture } from "./source-fixture.mjs";
import { createWorkspaceDB } from "../v2-sync/db18.mjs";
import { hash } from "../v2-sync/model.mjs";

const icons = new Set(
  [
    ...readFileSync(new URL("../../src/shared/sectionIcons.ts", import.meta.url), "utf8").matchAll(
      /"id": "([a-z0-9-]+)"/g,
    ),
  ].map((m) => m[1]),
);
const b64 = {
  base64ToBytes: (s) => Buffer.from(s, "base64"),
  bytesToBase64: (b) => Buffer.from(b).toString("base64"),
};
const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const WS = "11111111-1111-4111-8111-111111111111";
const restorer = createWorkspaceRestorer({ hash, bytesToBase64: b64.bytesToBase64 });
const expected = (core) => (v) => {
  const e = createWorkspaceDB(":memory:", v);
  try {
    return core.schemaModel(e);
  } finally {
    e.close();
  }
};
function toEnvelope(db) {
  const core = createCopyCore({ hash, randomUUID: seq(), ...b64 });
  const rows = core.captureRows(db, { allowNoteImages: true, expectedSchema: expected(core) });
  const copy = core.extractCopy(
    { sourceHash: "0".repeat(64), rows },
    { workspaceId: WS, sourceWorkspaceId: WS.replace("1", "2") },
  );
  const { envelope } = createWorkspaceMapper({ hash, sectionIconIds: icons }).mapCopy(copy, WS);
  return { core, rows, copy, envelope };
}

for (const [version, extra] of [
  [18, 0],
  [19, 0],
  [20, 0],
  [20, 1500],
])
  test(`DB${version}${extra ? ` +${extra}` : ""}: 온라인 형식 → 되살림 → 다시 온라인 형식 = 같음, 그림 해시 확인`, () => {
    const dir = mkdtempSync(join(tmpdir(), "wjb-restore-"));
    try {
      mkdirSync(join(dir, "s"));
      writeFileSync(join(dir, "s", ".v2-poc-only"), "synthetic");
      const file = join(dir, "s", "source.db");
      buildSourceFixture(file, version, extra);
      const src = new DatabaseSync(file, { readOnly: true });
      const a = toEnvelope(src);
      src.close();
      const { records, ...header } = a.envelope;
      const bySha = a.copy.blobBytes,
        objSha = new Map(header.assets.map((x) => [x.objectId, x.sha256]));
      const rows = restorer.toRows({ header, records }, (id) => bySha.get(objSha.get(id)));
      const db = createWorkspaceDB(join(dir, "s", "restored.db"), version);
      restorer.writeInto(db, rows);
      // 다시 온라인 형식으로 → 기록이 바이트 단위로 같다(되살림이 손실 없이 온라인 내용을 담음)
      const b = toEnvelope(db);
      assert.deepEqual(b.envelope.records, records);
      assert.equal(
        b.envelope.tableStats.entry_item?.mappedRows,
        a.envelope.tableStats.entry_item?.mappedRows,
      );
      // 온라인에 보낸 표는 원본 행과 같다(이 기기 전용 값만 다를 수 있는 표 제외)
      const lossy = new Set(["app_meta", "cabinet_item", "import_batch"]);
      for (const t of Object.keys(a.rows)) if (!lossy.has(t)) assert.deepEqual(b.rows[t], a.rows[t], t);
      assert.ok(header.assets.length > 0, "그림이 있는 가상 일지");
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test("그림 본문이 바뀌었거나 없으면 되살리지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "wjb-restore-"));
  try {
    mkdirSync(join(dir, "s"));
    writeFileSync(join(dir, "s", ".v2-poc-only"), "synthetic");
    const file = join(dir, "s", "source.db");
    buildSourceFixture(file, 20);
    const src = new DatabaseSync(file, { readOnly: true });
    const { envelope } = toEnvelope(src);
    src.close();
    const { records, ...header } = envelope;
    assert.throws(
      () => restorer.toRows({ header, records }, () => new Uint8Array([1, 2, 3])),
      /RESTORE_ASSET_MISMATCH/,
    );
    assert.throws(() => restorer.toRows({ header, records }, () => undefined), /RESTORE_ASSET_MISMATCH/);
    assert.throws(
      () => restorer.toRows({ header: { ...header, sourceSchema: 21 }, records }, () => undefined),
      /RESTORE_SCHEMA_VERSION/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
