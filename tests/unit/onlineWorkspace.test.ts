// @vitest-environment node
// D-3·D-4: 캐시 → 메모리 일지 되살리기(앱 경로: sql.js + 순수 JS 해시) · 읽기 전용 문지기
import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { migrate } from "../../src/data/migrate";
import { openSqlJs, SqlJsDriver } from "../../src/data/drivers/sqlJs";
import { seedSample } from "../../src/data/seed";
import sample from "../../fixtures/sample-showcase.json";
import { prepareCopy } from "../../src/preview/migrationEngine";
import { derivedId } from "../../src/preview/migrationSession";
import { readOnlyGate, restoreFromCache, OnlineReadOnlyError } from "../../src/preview/onlineWorkspace";
import type { PreviewSpaces } from "../../src/platform";
import { JournalRepository } from "../../src/data/repository";

const enc = new TextEncoder();
async function cacheFromSample() {
  const d = await openSqlJs();
  await migrate(d);
  await seedSample(d, sample as never);
  const SQL = await initSqlJs();
  const job = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  let n = 0;
  const p = prepareCopy(SQL, d.exportBytes(), {
    workspaceId: derivedId(job, "workspace"),
    sourceWorkspaceId: derivedId(job, "source"),
    randomUUID: () => derivedId(job, `object-${++n}`),
  });
  const { assets, ...header } = p.header;
  const files = new Map<string, Uint8Array>([
    [
      "header.json",
      enc.encode(
        JSON.stringify({
          workspaceId: p.workspaceId,
          manifestHash: "c".repeat(64),
          createdAt: null,
          header,
          assets,
        }),
      ),
    ],
    ["records.json", enc.encode(JSON.stringify(p.pages.flat()))],
  ]);
  for (const a of assets) files.set(`${a.sha256}.bin`, p.assetBytes.get(a.objectId)!);
  const spaces: PreviewSpaces = {
    list: async () => ({ workspaces: [] }),
    sync: async () => ({
      workspaceId: p.workspaceId,
      manifestHash: "c".repeat(64),
      records: 0,
      assets: 0,
      fromCache: true,
      stale: false,
    }),
    read: async (_w, name) => files.get(name)!,
    remove: async () => undefined,
  };
  return { SQL, spaces, p, files, src: d };
}

describe("온라인 공간 되살리기·읽기 전용", () => {
  it("캐시 → 메모리 일지: 업무·기록·그림이 원본과 같다", async () => {
    const { SQL, spaces, p, src } = await cacheFromSample();
    const r = await restoreFromCache(SQL, spaces, p.workspaceId);
    // 앱 저장소로 열린다(설정 읽기)
    const repo = new JournalRepository(new SqlJsDriver(new SQL.Database(r.bytes)), () => new Date());
    expect((await repo.getSettings()).backup).toBeTruthy();
    const names = async (d: { select<T>(s: string): Promise<T[]> }) =>
      (await d.select<{ name: string }>("SELECT name FROM category ORDER BY id")).map((x) => x.name);
    expect(await names(new SqlJsDriver(new SQL.Database(r.bytes)))).toEqual(await names(src));
    const count = async (d: { select<T>(s: string): Promise<T[]> }, t: string) =>
      (await d.select<{ n: number }>(`SELECT count(*) n FROM ${t}`))[0]!.n;
    const restored = new SqlJsDriver(new SQL.Database(r.bytes));
    for (const t of ["entry_item", "category", "note_asset", "week_note"])
      expect(await count(restored, t), t).toBe(await count(src, t));
    const img = await restored.select<{ data: string }>("SELECT data FROM note_asset LIMIT 1");
    const origImg = await src.select<{ data: string }>("SELECT data FROM note_asset LIMIT 1");
    expect(img[0]?.data).toBe(origImg[0]?.data);
  });

  it("그림 파일이 바뀌면 열지 않는다", async () => {
    const { SQL, spaces, p, files } = await cacheFromSample();
    const key = [...files.keys()].find((k) => k.endsWith(".bin"))!;
    files.set(key, new Uint8Array([1, 2, 3]));
    await expect(restoreFromCache(SQL, spaces, p.workspaceId)).rejects.toThrow("RESTORE_ASSET_MISMATCH");
  });

  it("문지기: 잠그기 전엔 그대로, 잠근 뒤 쓰기만 거절(조회·VACUUM INTO 사본은 됨)", async () => {
    const SQL = await initSqlJs();
    let blocked = 0;
    const gate = readOnlyGate(() => blocked++);
    const d = gate.wrap(new SqlJsDriver(new SQL.Database()));
    await d.execute("CREATE TABLE t(x)");
    await d.execute("INSERT INTO t VALUES(1)");
    gate.lock();
    await expect(d.execute("INSERT INTO t VALUES(2)")).rejects.toBeInstanceOf(OnlineReadOnlyError);
    await expect(d.batch([{ sql: "  update t SET x=3" }])).rejects.toBeInstanceOf(OnlineReadOnlyError);
    await expect(d.execute("PRAGMA user_version = 3")).rejects.toBeInstanceOf(OnlineReadOnlyError);
    expect(await d.select("SELECT x FROM t")).toEqual([{ x: 1 }]);
    expect(blocked).toBe(3);
  });
});
