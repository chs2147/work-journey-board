// @vitest-environment node
// G-7(docs/v2-design/101) 복구 리허설: 관리자 내보내기(export.mjs 형식) → 서버 없이 앱 일지(.db)로 되살리기 →
// 앱의 일지 열기 경로(구조 확인·마이그레이션·무결성)로 열리고, 업무·기록·그림이 내보낸 것과 같다.
// 가상 샘플은 늘 돌고, 실제 내보내기는 WJB_EXPORT_DIR(+ 되살린 .db를 둘 WJB_RESTORE_OUT)을 줄 때만 — 저장소에 남기지 않는다.
import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrate, quickCheck, readSchemaVersion, LATEST_SCHEMA_VERSION } from "../../src/data/migrate";
import { openSqlJs, SqlJsDriver } from "../../src/data/drivers/sqlJs";
import { seedSample } from "../../src/data/seed";
import sample from "../../fixtures/sample-showcase.json";
import { prepareCopy } from "../../src/preview/migrationEngine";
import { derivedId } from "../../src/preview/migrationSession";
import { restoreFromCache } from "../../src/preview/onlineWorkspace";
import { buildSpace } from "../../poc/v2-ops/export.mjs";
import type { PreviewSpaces } from "../../src/platform";
import type { SqlJsStatic } from "sql.js";

const enc = new TextEncoder();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 내보내기 폴더 하나(공간) → 되살리기가 읽는 모양 */
function reader(files: Map<string, Uint8Array>): PreviewSpaces {
  return {
    list: async () => ({ workspaces: [] }),
    sync: async () => {
      throw new Error("NOT_USED");
    },
    read: async (_w, name) => {
      const b = files.get(name);
      if (!b) throw new Error("EXPORT_FILE_MISSING");
      return b;
    },
    remove: async () => undefined,
    journal: {} as never,
    transport: {} as never,
  };
}

/** 되살린 일지를 앱처럼 연다: 최신 구조로 올리고 무결성 확인 → 표별 행 수 */
async function openRestored(SQL: SqlJsStatic, bytes: Uint8Array) {
  const d = new SqlJsDriver(new SQL.Database(bytes));
  await migrate(d);
  expect(await readSchemaVersion(d)).toBe(LATEST_SCHEMA_VERSION);
  expect(await quickCheck(d)).toBe(true);
  return d;
}

describe("G-7 내보내기 → 되살리기 리허설", () => {
  it("buildSpace: 기록이 참조하는 그림만 담고, 서버에 없는 그림을 참조하면 멈춘다", () => {
    const job = { workspace_id: derivedId("j", "w"), manifest_hash: "c".repeat(64) };
    const a1 = { objectId: derivedId("j", "a1"), sha256: "a".repeat(64), bytes: 10 };
    const a2 = { objectId: derivedId("j", "a2"), sha256: "b".repeat(64), bytes: 20 };
    const records = [
      { table: "note_asset", key: "k".repeat(64), value: { dataRef: a1, thumbRef: null } },
      { table: "entry_item", key: "e".repeat(64), value: { text: "가상" } },
    ];
    const s = buildSpace({ job, header: { sourceSchema: 20 }, records, assets: [a1, a2] });
    expect(s.header.assets).toEqual([a1]);
    expect(s.records).toHaveLength(2);
    expect(() => buildSpace({ job, header: {}, records, assets: [a2] })).toThrow("EXPORT_ASSET_MISSING");
  });

  it("가상 샘플: 내보내기 형식 → 앱 일지 → 앱처럼 열기, 업무·기록·그림이 그대로", async () => {
    const src = await openSqlJs();
    await migrate(src);
    await seedSample(src, sample as never);
    const SQL = await initSqlJs();
    const jobId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    let n = 0;
    const p = prepareCopy(SQL, src.exportBytes(), {
      workspaceId: derivedId(jobId, "workspace"),
      sourceWorkspaceId: derivedId(jobId, "source"),
      randomUUID: () => derivedId(jobId, `object-${++n}`),
    });
    const { assets, ...header } = p.header;
    const space = buildSpace({
      job: { workspace_id: p.workspaceId, manifest_hash: "c".repeat(64) },
      header,
      records: p.pages.flat(),
      assets,
    });
    const files = new Map<string, Uint8Array>([
      ["header.json", enc.encode(JSON.stringify(space.header))],
      ["records.json", enc.encode(JSON.stringify(space.records))],
    ]);
    for (const a of space.header.assets) files.set(`${a.sha256}.bin`, p.assetBytes.get(a.objectId)!);
    const r = await restoreFromCache(SQL, reader(files), p.workspaceId);
    const d = await openRestored(SQL, r.bytes);
    for (const t of ["category", "entry_item", "week_note", "note_asset"]) {
      const count = async (x: SqlJsDriver, tbl: string) =>
        (await x.select<{ n: number }>(`SELECT count(*) n FROM ${tbl}`))[0]!.n;
      expect(await count(d, t), t).toBe(await count(src, t));
    }
    const img = (x: SqlJsDriver) =>
      x.select<{ data: string }>("SELECT data FROM note_asset ORDER BY id LIMIT 1");
    expect((await img(d))[0]?.data).toBe((await img(src))[0]?.data);
  });

  const real = process.env.WJB_EXPORT_DIR;
  it.skipIf(!real)("실제 내보내기(WJB_EXPORT_DIR): 공간마다 되살려 앱처럼 열린다", async () => {
    const SQL = await initSqlJs();
    const manifest = JSON.parse(readFileSync(join(real!, "export-manifest.json"), "utf8")) as {
      spaces: { workspaceId: string; records: number; assets: number }[];
    };
    expect(manifest.spaces.length).toBeGreaterThan(0);
    const out = process.env.WJB_RESTORE_OUT;
    if (out && !existsSync(out)) mkdirSync(out, { recursive: true });
    const report: Record<string, unknown>[] = [];
    for (const s of manifest.spaces) {
      expect(s.workspaceId).toMatch(uuid);
      const dir = join(real!, s.workspaceId);
      const files = new Map(readdirSync(dir).map((f) => [f, new Uint8Array(readFileSync(join(dir, f)))]));
      const r = await restoreFromCache(SQL, reader(files), s.workspaceId);
      const d = await openRestored(SQL, r.bytes);
      const tables = await d.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('category','entry_item','week_note','note_asset','cabi_note','cabi_asset')",
      );
      const counts: Record<string, number> = {};
      for (const t of tables)
        counts[t.name] = (await d.select<{ n: number }>(`SELECT count(*) n FROM ${t.name}`))[0]!.n;
      report.push({ workspaceId: s.workspaceId, records: s.records, assets: s.assets, counts });
      if (out) writeFileSync(join(out, `${s.workspaceId}.db`), r.bytes);
    }
    if (out) writeFileSync(join(out, "restore-report.json"), JSON.stringify(report, null, 2) + "\n");
  });
});
