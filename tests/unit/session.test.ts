// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DATA_FILE, isRestorableName, runMirrorBackup } from "../../src/data/backup";
import { isCorruptError } from "../../src/data/driver";
import { openSqlJs } from "../../src/data/drivers/sqlJs";
import { JournalRepository } from "../../src/data/repository";
import {
  backupFolderStats,
  backupIfFirstToday,
  classifyFolder,
  inspectBackup,
  listRestorable,
  restoreFromBackup,
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

  it("맥 동기화 폴더(macos-spec 3-3): CloudStorage(OneDrive·Google Drive)·iCloud Drive·Dropbox", () => {
    expect(isOneDriveLike("/Users/me/Library/CloudStorage/OneDrive-Company/WJ", [])).toBe(true);
    expect(isOneDriveLike("/Users/me/Library/CloudStorage/GoogleDrive-me@x.com/내 드라이브", [])).toBe(true);
    expect(isOneDriveLike("/Users/me/Library/Mobile Documents/com~apple~CloudDocs/WJ", [])).toBe(true);
    expect(isOneDriveLike("/Users/me/Dropbox/WJ", [])).toBe(true);
    expect(isOneDriveLike("/Users/me/WorkJourney", [])).toBe(false);
    expect(isOneDriveLike("/Users/me/Documents/DropboxNotes", [])).toBe(false);
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

describe("백업 보강·복원(optimize-1031-plan O4·O5)", () => {
  async function journalWithBackup() {
    const fs = newFs();
    await fs.ensureDir("/d/WJ");
    const db = await openJournalAt(fs, "/d/WJ", now);
    const repo = new JournalRepository(db, now);
    await repo.createCategory("가상 업무", "2026-W43");
    await backupIfFirstToday(fs, db, "/d/WJ", now(), keep);
    return { fs, db, repo };
  }

  it("보조 위치: 그날 사본 + 최근 3일치만, 그 폴더의 다른 파일은 그대로", async () => {
    const { fs, db } = await journalWithBackup();
    await fs.ensureDir("/e/mirror");
    fs.writeFile("/e/mirror/내 문서.txt");
    for (const d of [18, 19, 20, 21, 22, 23])
      await runMirrorBackup(db, fs.backupFs, "/e/mirror", new Date(2026, 9, d, 9), fs.verifyCopy);
    expect(await fs.backupFs.list("/e/mirror")).toEqual([
      "work-journey_2026-10-21.db",
      "work-journey_2026-10-22.db",
      "work-journey_2026-10-23.db",
      "내 문서.txt",
    ]);
  });

  it("복원: 사본 검사·요약 → 지금 파일은 _before-restore로 보존 → 백업 내용으로 다시 열림 → 되돌리기도 같은 길", async () => {
    const { fs, db, repo } = await journalWithBackup();
    await repo.createCategory("백업 뒤에 만든 업무", "2026-W43");
    const list = await listRestorable(fs, "/d/WJ");
    expect(list.map((b) => b.name)).toEqual([
      "work-journey_2026-10-23.db",
      "work-journey_2026-10_monthly.db",
    ]);
    expect(await inspectBackup(fs, "/d/WJ", "work-journey_2026-10-23.db")).toMatchObject({
      ok: true,
      newer: false,
      categories: 1,
    });
    await db.close();
    const before = await restoreFromBackup(fs, "/d/WJ", "work-journey_2026-10-23.db", now());
    expect(before).toBe("work-journey_2026-10-23_0831_before-restore.db");
    const reopened = new JournalRepository(await openJournalAt(fs, "/d/WJ", now), now);
    expect((await reopened.listCategories()).categories.map((c) => c.name)).toEqual(["가상 업무"]);
    expect(await fs.backupFs.list("/d/WJ/backups")).toContain(before);
    expect(await inspectBackup(fs, "/d/WJ", before)).toMatchObject({ ok: true, categories: 2 });
  });

  it("복원 거부: 백업 이름이 아니거나 일지가 열려 있으면 아무것도 바꾸지 않는다 · 깨진 사본은 검사에서 걸러짐", async () => {
    const { fs } = await journalWithBackup();
    fs.writeFile("/d/WJ/backups/내 메모.db");
    await expect(restoreFromBackup(fs, "/d/WJ", "내 메모.db", now())).rejects.toThrow();
    await expect(restoreFromBackup(fs, "/d/WJ", "work-journey_2026-10-23.db", now())).rejects.toThrow(
      "열려 있습니다",
    );
    fs.writeFile("/d/WJ/backups/work-journey_2026-10-01.db", new TextEncoder().encode("깨짐".repeat(50)));
    expect((await inspectBackup(fs, "/d/WJ", "work-journey_2026-10-01.db")).ok).toBe(false);
    expect(isRestorableName("work-journey_2026-10-23_0831_pre-update.db")).toBe(true);
    expect(isRestorableName("work-journey.db")).toBe(false);
  });

  it("백업 폴더 용량: 종류별 개수·크기", async () => {
    const { fs } = await journalWithBackup();
    const stats = await backupFolderStats(fs, "/d/WJ");
    expect(stats.count).toBe(2);
    expect(stats.byKind.daily.count).toBe(1);
    expect(stats.byKind.monthly.count).toBe(1);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it("저장소: 쓰기 횟수, 백업 중(exclusive)에는 쓰기가 기다림, 파손 오류는 알림", async () => {
    const { repo } = await journalWithBackup();
    const w0 = repo.writeCount;
    const order: string[] = [];
    let release!: () => void;
    const job = repo.exclusive(
      () =>
        new Promise<void>((r) => {
          release = () => {
            order.push("backup");
            r();
          };
        }),
    );
    const write = repo.createCategory("기다린 업무", "2026-W43").then(() => order.push("write"));
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual([]);
    release();
    await Promise.all([job, write]);
    expect(order).toEqual(["backup", "write"]);
    expect(repo.writeCount).toBeGreaterThan(w0);
    expect(isCorruptError(new Error("database disk image is malformed"))).toBe(true);
    expect(isCorruptError(new Error("database is locked"))).toBe(false);
  });
});
