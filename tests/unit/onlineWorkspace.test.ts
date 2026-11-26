// @vitest-environment node
// D-3: 캐시 → 일지 되살리기(앱 경로: sql.js + 순수 JS 해시) · E-1: 이 기기 일지·대기열·백업 사본 경로
import { describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import { migrate } from "../../src/data/migrate";
import { openSqlJs, SqlJsDriver } from "../../src/data/drivers/sqlJs";
import { seedSample } from "../../src/data/seed";
import sample from "../../fixtures/sample-showcase.json";
import { prepareCopy } from "../../src/preview/migrationEngine";
import { derivedId } from "../../src/preview/migrationSession";
import { restoreFromCache } from "../../src/preview/onlineWorkspace";
import { ensureSpaceJournal } from "../../src/preview/spaceJournal";
import { createOnlinePlatform } from "../../src/platform/onlinePlatform";
import { openJournalAt } from "../../src/data/session";
import { prepareConnection } from "../../src/data/driver";
import { backupStructureMatches, quickCheck, readSchemaVersion } from "../../src/data/migrate";
import { hash } from "../../poc/v2-sync/hash-core.mjs";
import type { Database, SqlJsStatic } from "sql.js";
import type { PreviewSpaces, SpaceJournalStore } from "../../src/platform";
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
    journal: memJournal(SQL),
    transport: {} as never,
  };
  return { SQL, spaces, p, files, src: d };
}

describe("온라인 공간 되살리기·이 기기 일지", () => {
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

  it("E-1 이 기기 일지: 처음 한 번만 캐시에서 만들고, 기준(base)·대기열·트리거를 더한다", async () => {
    const { SQL, spaces, p } = await cacheFromSample();
    const store = memJournal(SQL);
    expect(await ensureSpaceJournal(SQL, spaces, store, p.workspaceId)).toBe(true);
    expect(await ensureSpaceJournal(SQL, spaces, store, p.workspaceId)).toBe(false);
    const d = await store.open(p.workspaceId);
    const one = async <T>(sql: string) => (await d.select<T>(sql))[0]!;
    expect((await one<{ n: number }>("SELECT count(*) n FROM wjb_sync_base")).n).toBe(p.pages.flat().length);
    expect((await one<{ n: number }>("SELECT count(*) n FROM wjb_sync_outbox")).n).toBe(0);
    expect((await one<{ v: string }>("SELECT v FROM wjb_sync_meta WHERE k='workspaceId'")).v).toBe(
      p.workspaceId,
    );
    // 제품 열기 경로(연결 설정·무결성·구조 검사·마이그레이션)가 동기화 표가 있어도 그대로 통과
    await prepareConnection(d);
    expect(await quickCheck(d)).toBe(true);
    expect(await backupStructureMatches(d, await readSchemaVersion(d))).toBe(true);
    await migrate(d);
    expect((await one<{ n: number }>("SELECT count(*) n FROM wjb_sync_outbox")).n).toBe(0);
  });

  it("E-1 대기열: 앱 쓰기는 같은 트랜잭션 안에서 (표, 키)를 적고, 받은 것 적용 중(applying)에는 적지 않는다", async () => {
    const { SQL, spaces, p } = await cacheFromSample();
    const store = memJournal(SQL);
    await ensureSpaceJournal(SQL, spaces, store, p.workspaceId);
    const d = await store.open(p.workspaceId);
    const outbox = async () =>
      (
        await d.select<{ tbl: string; pk: string }>("SELECT tbl, pk FROM wjb_sync_outbox ORDER BY tbl, pk")
      ).map((r) => `${r.tbl}:${r.pk}`);
    const [item] = await d.select<{ id: string }>("SELECT id FROM entry_item ORDER BY id LIMIT 1");
    await d.execute("UPDATE entry_item SET text = text || '!' WHERE id = ?", [item!.id]);
    expect(await outbox()).toEqual([`entry_item:${JSON.stringify([item!.id])}`]);
    // 묶음이 실패하면 대기열도 함께 되돌린다
    await expect(
      d.batch([
        { sql: "UPDATE entry_item SET text = 'x' WHERE id = ?", params: [item!.id] },
        { sql: "INSERT INTO entry_item(id) VALUES(NULL)" },
      ]),
    ).rejects.toThrow();
    expect(await outbox()).toHaveLength(1);
    // 받은 것 적용 중에는 적지 않는다
    await d.batch([
      { sql: "UPDATE wjb_sync_flag SET applying = 1 WHERE id = 1" },
      { sql: "UPDATE category SET name = name || '?' " },
      { sql: "UPDATE wjb_sync_flag SET applying = 0 WHERE id = 1" },
    ]);
    expect(await outbox()).toHaveLength(1);
    // 기록 키는 서버 기록 키 규칙(hash([표, 기본 키 값]))으로 맞출 수 있다
    const keys = new Set(p.pages.flat().map((r) => r.key));
    expect(keys.has(hash(["entry_item", [item!.id]]))).toBe(true);
  });

  it("E-1 플랫폼: 일지는 이 기기 일지로, 백업 사본(VACUUM INTO)은 가짜 폴더에만", async () => {
    const { SQL, spaces, p } = await cacheFromSample();
    const store = memJournal(SQL);
    await ensureSpaceJournal(SQL, spaces, store, p.workspaceId);
    const plat = createOnlinePlatform({
      SQL,
      workspaceId: p.workspaceId,
      openJournal: () => store.open(p.workspaceId),
      windows: { cabi: {} as never },
    });
    const dir = `/online/${p.workspaceId}`;
    const d = await openJournalAt(plat, dir, () => new Date());
    expect(await readSchemaVersion(d)).toBeGreaterThanOrEqual(18);
    await plat.backupFs.ensureDir(`${dir}/backups`);
    await d.execute(`VACUUM INTO '${dir}/backups/x.db.tmp'`);
    expect((await plat.stat(`${dir}/backups/x.db.tmp`)).size).toBeGreaterThan(1000);
    await expect(d.execute(`VACUUM INTO '${dir}/backups/x.db.tmp'`)).rejects.toThrow("already exists");
    await expect(d.execute("VACUUM INTO '/tmp/elsewhere.db'")).rejects.toThrow("unable to open");
    // UX-3 실기: 공간 폴더 밖(이 PC 새 공간 = 메모리 가짜 폴더)에는 폴더·일지·사본을 만들지 않는다
    const beside = `${dir}-test`;
    await expect(plat.ensureDir(beside)).rejects.toThrow("ONLINE_SPACE_ONLY");
    await expect(plat.openDatabase(`${beside}/work-journey.db`)).rejects.toThrow("ONLINE_SPACE_ONLY");
    await expect(plat.copyNew(`${dir}/backups/x.db.tmp`, "/online/other/x.db")).rejects.toThrow(
      "ONLINE_SPACE_ONLY",
    );
    await plat.ensureDir(`${dir}/backups`); // 안쪽은 그대로
    await d.close();
  });
});

/** 시험용 이 기기 일지 저장소(메모리, 열린 드라이버가 같은 DB를 씀) */
function memJournal(SQL: SqlJsStatic): SpaceJournalStore {
  const dbs = new Map<string, Database>();
  return {
    exists: async (w) => dbs.has(w),
    async create(w, bytes) {
      if (dbs.has(w)) throw new Error("JOURNAL_EXISTS");
      dbs.set(w, new SQL.Database(bytes));
    },
    async open(w) {
      const db = dbs.get(w);
      if (!db) throw new Error("JOURNAL_MISSING");
      const d = new SqlJsDriver(db);
      return {
        label: "시험",
        select: (s, ps) => d.select(s, ps),
        execute: (s, ps) => d.execute(s, ps),
        batch: (st) => d.batch(st),
        exportBytes: async () => d.exportBytes(),
        close: async () => undefined,
      };
    },
  };
}

it("온라인 Cabinet은 이 기기의 등록 경로만 조회하고 등록 해제 후에는 다시 조회하지 않는다", async () => {
  const stat = vi.fn(async () => ({ exists: true, isDir: true, size: 0 }));
  const roots = vi.fn<(paths: string[]) => Promise<void>>().mockResolvedValue(undefined);
  const platform = createOnlinePlatform({
    SQL: await initSqlJs(),
    workspaceId: "synthetic",
    windows: { cabi: {} as never },
    openJournal: async () => {
      throw new Error("path-only check");
    },
    nativeCabinet: {
      stat,
      pickFolder: async () => "/virtual/reference",
      pickFolders: async () => null,
      cabinetSetRoots: roots,
      cabinetList: async () => [],
      cabinetOpen: async () => undefined,
      cabinetReveal: async () => undefined,
    },
  });
  expect(await platform.pickFolder("워크스페이스")).toBeNull();
  expect(await platform.pickCabinetFolder!("등록 폴더")).toBe("/virtual/reference");
  await platform.cabinetSetRoots(["/virtual/reference"]);
  expect((await platform.cabinetStat!("/virtual/other")).exists).toBe(false);
  expect((await platform.cabinetStat!("/virtual/reference")).exists).toBe(true);
  await platform.cabinetSetRoots([]);
  expect((await platform.cabinetStat!("/virtual/reference")).exists).toBe(false);
  expect(stat.mock.calls).toHaveLength(1);
  expect(roots.mock.calls).toEqual([[["/virtual/reference"]], [[]]]);
});

// hotfix 1.54.1: 온라인 공간을 연 정식판도 새 판을 찾는다 — 예전엔 늘 null("최신 판")이었다
it("온라인 공간 플랫폼은 받은 정식 업데이트 경로를 그대로 쓰고, 없으면 새 판 없음", async () => {
  const SQL = await initSqlJs();
  const base = {
    SQL,
    workspaceId: "synthetic",
    windows: { cabi: {} as never },
    openJournal: async () => {
      throw new Error("path-only check");
    },
  };
  const info = { version: "9.9.9", notes: "", size: 1, hasHash: true };
  const updates = {
    updateCheck: vi.fn(async () => info),
    updateDownload: vi.fn(async () => undefined),
    updateInstall: vi.fn(async () => undefined),
  };
  const local = { kind: "tauri" } as never;
  const p = createOnlinePlatform({ ...base, updates, localPlatform: local });
  expect(await p.updateCheck()).toEqual(info);
  const prog = () => undefined;
  await p.updateDownload(prog);
  await p.updateInstall();
  expect(updates.updateDownload).toHaveBeenCalledWith(prog);
  expect(updates.updateInstall).toHaveBeenCalledTimes(1);
  expect(p.localPlatform).toBe(local);
  const plain = createOnlinePlatform(base);
  expect(await plain.updateCheck()).toBeNull();
  expect(plain.localPlatform).toBeUndefined();
});
