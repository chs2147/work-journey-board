// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DATA_FILE } from "../../src/data/backup";
import { openSqlJs } from "../../src/data/drivers/sqlJs";
import { JournalRepository } from "../../src/data/repository";
import {
  backupIfFirstToday,
  classifyFolder,
  copyJournalTo,
  FolderMissingError,
  IntegrityError,
  latestBackup,
  MoveError,
  openJournalAt,
} from "../../src/data/session";
import { createFakeFs } from "../../src/platform/fakeFs";
import { isOneDriveLike } from "../../src/platform/index";

const now = () => new Date(2026, 9, 23, 8, 31);
const keep = { daily: 14, monthly: 12 };
const newFs = () => createFakeFs((bytes, label) => openSqlJs(undefined, bytes, label));

describe("일지 열기 (data-spec 7-3·7-5)", () => {
  it("빈 폴더면 새 일지를 만들고 스키마를 준비한다", async () => {
    const fs = newFs();
    await fs.ensureDir("/d/WJ");
    const db = await openJournalAt(fs, "/d/WJ", now);
    const repo = new JournalRepository(db, now);
    await repo.createCategory("가", "2026-W43");
    expect((await repo.listCategories()).categories).toHaveLength(1);
    expect(fs.listAll()).toContain(`/d/WJ/${DATA_FILE}`);
  });

  it("폴더가 없으면 FolderMissingError(파일을 만들지 않음)", async () => {
    const fs = newFs();
    await expect(openJournalAt(fs, "/없는/폴더", now)).rejects.toBeInstanceOf(FolderMissingError);
    expect(fs.listAll()).toEqual([]);
  });

  it("손상된 파일이면 IntegrityError", async () => {
    const fs = newFs();
    fs.writeFile(
      `/d/WJ/${DATA_FILE}`,
      new TextEncoder().encode("SQLite format 3\0 깨진 파일".padEnd(200, "x")),
    );
    await expect(openJournalAt(fs, "/d/WJ", now)).rejects.toBeInstanceOf(IntegrityError);
  });

  it("그날 첫 실행에만 자동 백업, 같은 날 두 번째는 건너뜀", async () => {
    const fs = newFs();
    await fs.ensureDir("/d/WJ");
    const db = await openJournalAt(fs, "/d/WJ", now);
    const first = await backupIfFirstToday(fs, db, "/d/WJ", now(), keep);
    expect(first?.daily).toBe("/d/WJ/backups/work-journey_2026-10-23.db");
    expect(first?.monthly).toBe("/d/WJ/backups/work-journey_2026-10_monthly.db");
    expect(await backupIfFirstToday(fs, db, "/d/WJ", now(), keep)).toBeNull();
  });
});

describe("저장 폴더 분류·OneDrive (overview 10-10)", () => {
  it("같은 폴더 / 일지 있음 / 빈 폴더", async () => {
    const fs = newFs();
    await fs.ensureDir("/a");
    await fs.ensureDir("/b");
    fs.writeFile(`/b/${DATA_FILE}`);
    expect(await classifyFolder(fs, "/a", "/a/")).toBe("same");
    expect(await classifyFolder(fs, "/a", "/b")).toBe("has-journal");
    expect(await classifyFolder(fs, "/a", "/c")).toBe("empty");
  });

  it("OneDrive 경로 판정: 환경 변수 접두어 또는 \\OneDrive 포함", () => {
    const roots = ["C:\\Users\\me\\OneDrive - Company"];
    expect(isOneDriveLike("C:\\Users\\me\\OneDrive - Company\\문서\\WJ", roots)).toBe(true);
    expect(isOneDriveLike("c:\\users\\me\\onedrive - company", roots)).toBe(true);
    expect(isOneDriveLike("D:\\Sync\\OneDrive\\WJ", [])).toBe(true);
    expect(isOneDriveLike("C:\\Users\\me\\WorkJourney", roots)).toBe(false);
    expect(isOneDriveLike("D:\\work_logs", roots)).toBe(false);
    expect(isOneDriveLike("D:\\OneDriveBackup", [])).toBe(false);
  });
});

describe("저장 위치 옮기기 (overview 10-10)", () => {
  async function setup() {
    const fs = newFs();
    await fs.ensureDir("/old");
    const db = await openJournalAt(fs, "/old", now);
    const repo = new JournalRepository(db, now);
    await repo.createCategory("옮길 업무", "2026-W43");
    await backupIfFirstToday(fs, db, "/old", now(), keep);
    fs.writeFile("/old/backups/내 파일.txt");
    return { fs, db };
  }

  it("수동 백업 → 새 폴더에 사본 → 검사 → 백업 복사, 원본은 그대로", async () => {
    const { fs, db } = await setup();
    const r = await copyJournalTo(fs, db, "/old", "/new", true, now());
    expect(r.copiedBackups).toBe(3); // 일일·월간·방금 만든 수동 백업
    expect(r.skippedBackups).toBe(1); // 내 파일.txt
    const moved = await openJournalAt(fs, "/new", now);
    expect((await new JournalRepository(moved, now).listCategories()).categories.map((c) => c.name)).toEqual([
      "옮길 업무",
    ]);
    const all = fs.listAll();
    expect(all).toContain(`/old/${DATA_FILE}`);
    expect(all).toContain("/old/backups/work-journey_2026-10-23_0831_manual.db");
    expect(all).toContain("/new/backups/work-journey_2026-10-23.db");
    expect(all).not.toContain("/new/backups/내 파일.txt");
  });

  it("백업 복사 끄면 일지 파일만", async () => {
    const { fs, db } = await setup();
    await copyJournalTo(fs, db, "/old", "/new", false, now());
    expect(fs.listAll().filter((p) => p.startsWith("/new"))).toEqual([`/new/${DATA_FILE}`]);
  });

  it("대상에 일지가 있으면 덮어쓰지 않고 실패(copy 단계)", async () => {
    const { fs, db } = await setup();
    fs.writeFile(`/new/${DATA_FILE}`, new Uint8Array([7, 7, 7]));
    const err = await copyJournalTo(fs, db, "/old", "/new", true, now()).catch((e) => e);
    expect(err).toBeInstanceOf(MoveError);
    expect((err as MoveError).step).toBe("copy");
    expect((await fs.stat(`/new/${DATA_FILE}`)).size).toBe(3);
  });
});

describe("최근 백업 표시", () => {
  it("이름에서 시각을 읽어 가장 최근 것", () => {
    expect(
      latestBackup([
        "work-journey_2026-10_monthly.db",
        "work-journey_2026-10-22.db",
        "work-journey_2026-10-23_0831_manual.db",
        "work-journey_2026-10-01_0900_pre-migration-v2.db",
        "내 파일.txt",
      ]),
    ).toEqual({ name: "work-journey_2026-10-23_0831_manual.db", when: "2026-10-23 08:31", kind: "manual" });
    expect(latestBackup(["work-journey_2026-10-23.db", "work-journey_2026-10-23_0831_manual.db"])?.kind).toBe(
      "manual",
    );
    expect(latestBackup(["work-journey_2026-10-24.db", "work-journey_2026-10-23_0831_manual.db"])?.kind).toBe(
      "daily",
    );
    expect(latestBackup([])).toBeNull();
  });
});
