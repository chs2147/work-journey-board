// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  BackupError,
  backupNames,
  isDeletableByApp,
  planRotation,
  runAutoBackup,
  runManualBackup,
  writeBackup,
  type BackupFs,
} from "../../src/data/backup";
import type { SqlDriver } from "../../src/data/driver";
import { quickCheck } from "../../src/data/migrate";
import { freshRepo } from "./helpers";

let realSeq = 0;

/**
 * 테스트용 백업 파일 시스템. 사본은 sql.js 가상 FS에 VACUUM INTO로 **실제로** 만들고(검증은 ATTACH로),
 * 폴더 목록·이름 바꾸기·삭제는 이름표(Map)로 흉내 낸다(sql.js가 가상 FS를 내보내지 않으므로).
 */
function memFs(db: SqlDriver) {
  const files = new Map<string, string | null>(); // 경로 → 실제 사본 경로(null = 일반 파일)
  const removed: string[] = [];
  const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
  const fs: BackupFs = {
    join: (...p) => p.join("/").replace(/\/+/g, "/"),
    ensureDir: async () => undefined,
    list: async (d) => [...files.keys()].filter((p) => dirOf(p) === d).map((p) => p.slice(d.length + 1)),
    rename: async (a, b) => {
      files.set(b, files.get(a) ?? null);
      files.delete(a);
    },
    remove: async (p) => {
      removed.push(p);
      files.delete(p);
    },
  };
  const driver: SqlDriver = {
    ...db,
    label: db.label,
    execute: async (sql, params) => {
      const m = /^VACUUM INTO '(.+)'$/.exec(sql);
      if (!m) return db.execute(sql, params);
      const real = `/tmp/wjb-real-${realSeq++}.db`;
      await db.execute(`VACUUM INTO '${real}'`);
      files.set(m[1]!.replace(/''/g, "'"), real);
      return { changes: 0 };
    },
    select: (sql, params) => db.select(sql, params),
    batch: (s) => db.batch(s),
    close: () => db.close(),
  };
  async function attached<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const real = files.get(path);
    if (!real) throw new Error(`사본 아님: ${path}`);
    await db.execute(`ATTACH DATABASE '${real}' AS copy`);
    try {
      return await fn();
    } finally {
      await db.execute("DETACH DATABASE copy");
    }
  }
  const verify = (path: string) =>
    attached(path, async () => {
      const rows = await db.select<{ quick_check: string }>("PRAGMA copy.quick_check");
      return rows[0]?.quick_check === "ok";
    });
  const categoryNames = (path: string) =>
    attached(path, async () =>
      (await db.select<{ name: string }>("SELECT name FROM copy.category")).map((r) => r.name),
    );
  const writeFile = (p: string) => void files.set(p, null);
  return { fs, driver, verify, categoryNames, removed, writeFile };
}

let dirSeq = 0;
const newDir = () => `/tmp/wjb-${Date.now()}-${dirSeq++}`;

describe("백업 파일명 (data-spec 7-1, 로컬 시각)", () => {
  it("일일·월간·수동·마이그레이션 이름", () => {
    const now = new Date(2026, 9, 23, 8, 31);
    expect(backupNames.daily(now)).toBe("work-journey_2026-10-23.db");
    expect(backupNames.monthly(now)).toBe("work-journey_2026-10_monthly.db");
    expect(backupNames.manual(now)).toBe("work-journey_2026-10-23_0831_manual.db");
    expect(backupNames.preMigration(now, 2)).toBe("work-journey_2026-10-23_0831_pre-migration-v2.db");
  });
});

describe("롤링 삭제 대상 (CLAUDE.md 4-3: 패턴 외 파일 보존)", () => {
  const files = [
    ...Array.from({ length: 16 }, (_, i) => `work-journey_2026-10-${String(i + 1).padStart(2, "0")}.db`),
    ...Array.from(
      { length: 13 },
      (_, i) =>
        `work-journey_${2025 + Math.floor((i + 9) / 12)}-${String(((i + 9) % 12) + 1).padStart(2, "0")}_monthly.db`,
    ),
    "work-journey_2026-10-01_0900_manual.db",
    "work-journey_2026-09-01_0900_pre-migration-v2.db",
    "work-journey.db",
    "내 메모.txt",
    "work-journey_2026-10-01.db.bak",
    "work-journey_2026-1-1.db",
  ];

  it("일일은 최신 14개, 월간은 최신 12개만 남긴다", () => {
    expect(planRotation(files, { daily: 14, monthly: 12 })).toEqual([
      "work-journey_2026-10-02.db",
      "work-journey_2026-10-01.db",
      "work-journey_2025-10_monthly.db",
    ]);
  });

  it("패턴 외 파일은 절대 대상이 아니다", () => {
    const del = planRotation(files, { daily: 1, monthly: 0 });
    for (const keep of files.filter((f) => !/^work-journey_\d{4}-\d{2}(-\d{2})?(_monthly)?\.db$/.test(f))) {
      expect(del).not.toContain(keep);
    }
    for (const f of [
      "work-journey.db",
      "work-journey_2026-10-01_0900_manual.db",
      "work-journey_2026-09-01_0900_pre-migration-v2.db",
      "내 메모.txt",
      "work-journey_2026-10-01.db.bak",
      "work-journey_2026-1-1.db",
    ]) {
      expect(isDeletableByApp(f)).toBe(false);
    }
  });
});

describe("VACUUM INTO 백업 (sql.js 가상 FS에서 실제 파일)", () => {
  it("열린 DB에서 사본 생성 → 검증 통과 → 데이터 동일", async () => {
    const { db, repo } = await freshRepo();
    await repo.createCategory("백업 확인", "2026-W43");
    const { fs, driver, verify, categoryNames } = memFs(db);
    const dir = newDir();
    const path = await runManualBackup(driver, fs, dir, new Date(2026, 9, 23, 8, 31), verify);
    expect(path).toBe(`${dir}/backups/work-journey_2026-10-23_0831_manual.db`);
    expect(await categoryNames(path)).toEqual(["백업 확인"]);
    expect(await quickCheck(db)).toBe(true);
  });

  it("자동 백업: 같은 날은 덮어쓰고, 월간은 달에 한 번, 롤링은 패턴 파일만 삭제", async () => {
    const { db } = await freshRepo();
    const { fs, driver, verify, removed, writeFile } = memFs(db);
    const dir = newDir();
    await fs.ensureDir(`${dir}/backups`);
    for (let d = 1; d <= 14; d++)
      writeFile(`${dir}/backups/work-journey_2026-10-${String(d).padStart(2, "0")}.db`);
    writeFile(`${dir}/backups/work-journey_2026-10-01_0900_manual.db`);
    writeFile(`${dir}/backups/내 파일.txt`);

    const r1 = await runAutoBackup(
      driver,
      fs,
      dir,
      new Date(2026, 9, 23, 9, 0),
      { daily: 14, monthly: 12 },
      verify,
    );
    expect(r1.monthly).not.toBeNull();
    expect(r1.deleted).toEqual(["work-journey_2026-10-01.db"]);
    const r2 = await runAutoBackup(
      driver,
      fs,
      dir,
      new Date(2026, 9, 23, 18, 0),
      { daily: 14, monthly: 12 },
      verify,
    );
    expect(r2.monthly).toBeNull(); // 이번 달 월간 사본은 이미 있음
    expect(r2.deleted).toEqual([]); // 같은 날 덮어쓰기라 개수 그대로

    const left = await fs.list(`${dir}/backups`);
    expect(left).toContain("work-journey_2026-10-01_0900_manual.db");
    expect(left).toContain("내 파일.txt");
    expect(left.filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(removed.every((p) => isDeletableByApp(p.split("/").pop()!))).toBe(true);
  });

  it("검증 실패 시 임시 사본만 지우고 기존 백업은 그대로", async () => {
    const { db } = await freshRepo();
    const { fs, driver, writeFile } = memFs(db);
    const dir = newDir();
    await fs.ensureDir(dir);
    writeFile(`${dir}/work-journey_2026-10-23.db`);
    await expect(
      writeBackup(driver, fs, dir, "work-journey_2026-10-23.db", async () => false),
    ).rejects.toBeInstanceOf(BackupError);
    expect(await fs.list(dir)).toEqual(["work-journey_2026-10-23.db"]);
  });

  it("지난 실패의 임시 파일이 남아 있어도 다시 백업된다", async () => {
    const { db } = await freshRepo();
    const { fs, driver, verify, writeFile } = memFs(db);
    const dir = newDir();
    await fs.ensureDir(dir);
    writeFile(`${dir}/work-journey_2026-10-23.db.tmp`);
    await writeBackup(driver, fs, dir, "work-journey_2026-10-23.db", verify);
    expect(await fs.list(dir)).toEqual(["work-journey_2026-10-23.db"]);
  });

  it("삭제 가드: 허용 패턴이 아니면 지우지 않고 예외", async () => {
    const { db } = await freshRepo();
    const { fs, driver } = memFs(db);
    const remove = vi.spyOn(fs, "remove");
    // 임시 이름이 패턴에 맞지 않도록 사용자 파일명을 백업 이름으로 넘겨 본다
    const dir = newDir();
    await fs.ensureDir(dir);
    await expect(writeBackup(driver, fs, dir, "내 파일.txt", async () => false)).rejects.toBeInstanceOf(
      BackupError,
    );
    expect(remove).not.toHaveBeenCalled();
  });
});
