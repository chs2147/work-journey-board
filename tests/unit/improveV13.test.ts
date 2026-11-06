// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { parseBackupName, versionedBackupName, BACKUP_APP_VERSION } from "../../src/data/backupIdentity";
import {
  normalizeBackupPolicy,
  RECOMMENDED_BACKUP_POLICY,
  planBackupCleanup,
  type BackupFile,
} from "../../src/data/backupPolicy";
import {
  isRestorableName,
  previewBackupCleanup,
  executeBackupCleanup,
  runManualBackup,
  runMirrorBackup,
  runAutoBackup,
  runPreMigrationBackup,
  isDeletableByApp,
  uniqueBackupName,
  backupExclusive,
} from "../../src/data/backup";
import { createFakeFs } from "../../src/platform/fakeFs";
import { openSqlJs } from "../../src/data/drivers/sqlJs";
import { openJournalAt, inspectBackup, restoreFromBackup } from "../../src/data/session";
import { JournalRepository } from "../../src/data/repository";
import { LATEST_SCHEMA_VERSION } from "../../src/data/migrate";
const now = new Date(2026, 10, 5, 14, 30, 12, 123);
const file = (day: number, kind: "daily" | "monthly" | "manual" = "daily", safe = true): BackupFile => ({
  name: versionedBackupName(new Date(2026, 10, day, 9), kind, 14),
  size: 100,
  modified: 1,
  safe,
});
async function setup() {
  const fs = createFakeFs((b, l) => openSqlJs(undefined, b, l));
  await fs.ensureDir("/w");
  const db = await openJournalAt(fs, "/w", () => now);
  return { fs, db, repo: new JournalRepository(db, () => now) };
}
describe("v13 식별·정리 계획", () => {
  it("Rust와 같은 허용/삭제 이름 사례", () => {
    for (const line of readFileSync(new URL("../../fixtures/backup-name-cases.tsv", import.meta.url), "utf8")
      .trim()
      .split("\n")
      .filter((s) => !s.startsWith("#"))) {
      const [name, restorable, deletable] = line.split("\t");
      expect(isRestorableName(name!), name).toBe(restorable === "true");
      expect(isDeletableByApp(name!), name).toBe(deletable === "true");
    }
  });
  it("모든 종류·RC·충돌·구형과 실제 원본/목적지 구조를 구분", () => {
    const n = versionedBackupName(now, "pre-migration", 13, 14);
    expect(n).toContain("pre-migration-to-v14");
    expect(parseBackupName(n)).toMatchObject({
      kind: "pre-migration",
      schemaVersion: 13,
      appVersion: BACKUP_APP_VERSION,
    });
    const rc = n.replace(`app-v${BACKUP_APP_VERSION}`, "app-v1.17.0-rc.1+build.4").replace(".db", "_c2.db");
    expect(parseBackupName(rc)).not.toBeNull();
    expect(parseBackupName("work-journey_2026-10-23_0831_manual.db")).toMatchObject({
      legacy: true,
      appVersion: null,
      schemaVersion: null,
    });
    for (const bad of [
      n.replace("2026-11-05", "2026-02-30"),
      n.replace("143012123", "243012123"),
      n.replace("db-v13", "db-v0"),
      n.replace(`app-v${BACKUP_APP_VERSION}`, "app-v1.2.3-01"),
      n.replace(".db", "/../x.db"),
    ])
      expect(parseBackupName(bad)).toBeNull();
  });
  it("기존 설정은 개수/14개 유지, 새 추천은 기간30일·용량끄기, 이상값 거부", () => {
    expect(normalizeBackupPolicy({ dailyKeep: 14, monthlyKeep: 12, periodicHours: 2 })).toMatchObject({
      retentionMode: "count",
      dailyKeep: 14,
      maxBytes: null,
    });
    expect(RECOMMENDED_BACKUP_POLICY).toMatchObject({
      retentionMode: "days",
      retentionDays: 30,
      maxBytes: null,
    });
    expect(normalizeBackupPolicy({ maxBytes: NaN, retentionDays: 0, monthlyKeep: -1 })).toMatchObject({
      maxBytes: null,
      retentionDays: 30,
      monthlyKeep: 12,
    });
  });
  it("오늘 포함 날짜 경계, 최신1개와 보호·외부·검사 실패 파일 보존", () => {
    const files = [
      file(1),
      file(3),
      file(4),
      file(5),
      file(1, "manual"),
      { ...file(2), safe: false },
      { name: "note.txt", size: 20, modified: 1, safe: false },
    ];
    const p = planBackupCleanup(files, { ...RECOMMENDED_BACKUP_POLICY, retentionDays: 3 }, now);
    expect(p.candidates.map((x) => x.name)).toEqual([file(1).name]);
    expect(p.protectedCount).toBe(1);
    const min = planBackupCleanup([file(1)], { ...RECOMMENDED_BACKUP_POLICY, retentionDays: 1 }, now);
    expect(min.candidates).toEqual([]);
  });
  it("용량 우선 정리에서도 수동·최신 사본 보존, 목표 초과 표시", () => {
    const scale = (f: BackupFile) => ({ ...f, size: 300 * 1024 ** 2 });
    const files = [scale(file(1)), scale(file(2)), scale(file(5)), scale(file(1, "manual"))];
    const p = planBackupCleanup(files, { ...RECOMMENDED_BACKUP_POLICY, maxBytes: 256 * 1024 ** 2 }, now);
    expect(p.candidates.map((f) => f.reason)).toEqual(["capacity", "capacity"]);
    expect(p.after).toBe(600 * 1024 ** 2);
    expect(p.overBudget).toBe(true);
  });
  it("미래 날짜는 최신 사본 보호를 빼앗지 않음, 월간0 후보", () => {
    const p = planBackupCleanup(
      [file(1), file(5), file(6), file(1, "monthly")],
      {
        ...RECOMMENDED_BACKUP_POLICY,
        dailyKeep: 1,
        retentionMode: "count",
        monthlyKeep: 0,
        maxBytes: 256 * 1024 ** 2,
      },
      now,
    );
    expect(p.candidates.map((f) => f.name)).toEqual([file(1).name, file(1, "monthly").name]);
  });
});
describe("v13 실제 SQLite 백업 안전성", () => {
  it("신규·기존 설정 호환, 같은 날짜·버전 교체와 충돌 시각 보존", async () => {
    const { fs, db, repo } = await setup();
    expect((await repo.getSettings()).backup.retentionMode).toBe("days");
    await db.execute("UPDATE app_meta SET value=? WHERE key='settings'", [
      JSON.stringify({ backup: { dailyKeep: 7, monthlyKeep: 12, periodicHours: 2 } }),
    ]);
    expect((await new JournalRepository(db, () => now).getSettings()).backup.retentionMode).toBe("count");
    const one = await runAutoBackup(db, fs.backupFs, "/w", now, { daily: 14, monthly: 12 }, fs.verifyCopy);
    const two = await runAutoBackup(db, fs.backupFs, "/w", now, { daily: 14, monthly: 12 }, fs.verifyCopy);
    expect(two.daily).toContain("_c1.db");
    expect(fs.listAll()).not.toContain(one.daily);
    expect(fs.listAll()).toContain(two.daily);
    expect(two.monthly).toBeNull();
    const manual = await runManualBackup(db, fs.backupFs, "/w", now, fs.verifyCopy);
    const again = await runManualBackup(db, fs.backupFs, "/w", now, fs.verifyCopy);
    expect(again).not.toBe(manual);
    expect(fs.listAll()).toContain(manual);
    await db.close();
  });
  it("구조 변경 전 실제 구조 기록, 같은 날 다른 구조 사본 유지", async () => {
    const { fs, db } = await setup();
    await db.execute("ALTER TABLE entry_item DROP COLUMN completion_was_flagged");
    await db.execute("UPDATE app_meta SET value='13' WHERE key='schema_version'");
    const pre = await runPreMigrationBackup(db, fs.backupFs, "/w", now, 14, fs.verifyCopy);
    expect(parseBackupName(pre.split("/").at(-1)!)).toMatchObject({
      schemaVersion: 13,
      kind: "pre-migration",
    });
    const old = await runAutoBackup(db, fs.backupFs, "/w", now, { daily: 14, monthly: 0 }, fs.verifyCopy);
    await db.execute("ALTER TABLE entry_item ADD COLUMN completion_was_flagged INTEGER NOT NULL DEFAULT 1");
    await db.execute("UPDATE app_meta SET value='14' WHERE key='schema_version'");
    const latest = await runAutoBackup(db, fs.backupFs, "/w", now, { daily: 14, monthly: 0 }, fs.verifyCopy);
    expect(fs.listAll()).toContain(old.daily);
    expect(fs.listAll()).toContain(latest.daily);
    await db.close();
  });
  it("복원 전 실제 구조 검사, 새 구조·정보 불일치 원본 보존", async () => {
    const { fs, db, repo } = await setup();
    await repo.createCategory("가상 업무", "2026-W45");
    const original = await runManualBackup(db, fs.backupFs, "/w", now, fs.verifyCopy);
    const name = original.split("/").at(-1)!;
    expect(await inspectBackup(fs, "/w", name)).toMatchObject({
      ok: true,
      schemaVersion: LATEST_SCHEMA_VERSION,
    });
    fs.movePath(original, original.replace(`db-v${LATEST_SCHEMA_VERSION}`, "db-v13"));
    const mismatch = name.replace(`db-v${LATEST_SCHEMA_VERSION}`, "db-v13");
    expect(await inspectBackup(fs, "/w", mismatch)).toMatchObject({ ok: false, reason: "mismatch" });
    await expect(restoreFromBackup(fs, "/w", mismatch, now)).rejects.toThrow();
    expect(fs.listAll()).toContain("/w/work-journey.db");
    await db.execute(`UPDATE app_meta SET value='${LATEST_SCHEMA_VERSION + 1}' WHERE key='schema_version'`);
    const future = await runManualBackup(db, fs.backupFs, "/w", new Date(2026, 10, 5, 15), fs.verifyCopy);
    expect(await inspectBackup(fs, "/w", future.split("/").at(-1)!)).toMatchObject({
      ok: false,
      newer: true,
    });
    await db.close();
  });
  it("정리 미리보기 변경 시 전체 중단, 정상 후보만 삭제·보호/깨진/외부 파일 유지", async () => {
    const { fs, db } = await setup();
    for (let d = 1; d <= 5; d++)
      await runAutoBackup(
        db,
        fs.backupFs,
        "/w",
        new Date(2026, 10, d, 9),
        { daily: 14, monthly: 0 },
        fs.verifyCopy,
      );
    await runManualBackup(db, fs.backupFs, "/w", now, fs.verifyCopy);
    fs.writeFile("/w/backups/note.txt");
    fs.writeFile("/w/backups/work-journey_2026-10-01.db", new Uint8Array([1, 2]));
    const policy = { ...RECOMMENDED_BACKUP_POLICY, retentionDays: 2 };
    const plan = await previewBackupCleanup(fs.backupFs, "/w/backups", policy, now);
    expect(plan.candidates).toHaveLength(3);
    fs.writeFile("/w/backups/other.txt");
    await expect(executeBackupCleanup(fs.backupFs, "/w/backups", plan)).rejects.toThrow("변경");
    expect(
      (await fs.backupFs.list("/w/backups")).filter((n) => parseBackupName(n)?.kind === "daily"),
    ).toHaveLength(6);
    const fresh = await previewBackupCleanup(fs.backupFs, "/w/backups", policy, now);
    const result = await executeBackupCleanup(fs.backupFs, "/w/backups", fresh);
    expect(result.failed).toEqual([]);
    expect(result.deleted).toHaveLength(3);
    for (const name of result.deleted) expect(isDeletableByApp(name)).toBe(true);
    expect(fs.listAll()).toContain("/w/backups/note.txt");
    expect(fs.listAll()).toContain("/w/backups/work-journey_2026-10-01.db");
    await db.close();
  });
  it("보류 중 같은 날짜 교체도 없음, 생성 실패/정리 부분 실패에 기존 사본 보존", async () => {
    const { fs, db } = await setup();
    const first = await runAutoBackup(db, fs.backupFs, "/w", now, { daily: 14, monthly: 0 }, fs.verifyCopy);
    await runAutoBackup(db, fs.backupFs, "/w", now, { daily: 14, monthly: 0, preserve: true }, fs.verifyCopy);
    expect(fs.listAll()).toContain(first.daily);
    await expect(runManualBackup(db, fs.backupFs, "/w", now, async () => false)).rejects.toThrow();
    expect(fs.listAll()).toContain(first.daily);
    const name = await uniqueBackupName(
      fs.backupFs,
      "/w/backups",
      versionedBackupName(now, "daily", LATEST_SCHEMA_VERSION),
    );
    expect(name).toContain("_c2.db");
    await runAutoBackup(
      db,
      fs.backupFs,
      "/w",
      new Date(2026, 10, 1),
      { daily: 14, monthly: 0 },
      fs.verifyCopy,
    );
    const plan = await previewBackupCleanup(
      fs.backupFs,
      "/w/backups",
      { ...RECOMMENDED_BACKUP_POLICY, retentionDays: 1 },
      now,
    );
    vi.spyOn(fs.backupFs, "remove").mockRejectedValue(new Error("권한"));
    const result = await executeBackupCleanup(fs.backupFs, "/w/backups", plan);
    expect(result.failed.length).toBeGreaterThan(0);
    expect(result.deleted).toEqual([]);
    await db.close();
  });
  it("동일 폴더 작업은 실패 후에도 순서대로 처리", async () => {
    const events: string[] = [];
    const one = backupExclusive("/w/backups", async () => {
      events.push("one");
      throw Error("fail");
    }).catch(() => undefined);
    const two = backupExclusive("/w/backups", async () => {
      events.push("two");
    });
    await Promise.all([one, two]);
    expect(events).toEqual(["one", "two"]);
  });
});

it("v13 구형 구조 실제 복원 후 전진 마이그레이션, 원본 백업은 그대로", async () => {
  const { fs, db, repo } = await setup();
  await repo.createCategory("가상 복원 업무", "2026-W45");
  await db.execute("DROP TABLE note_entry_link");
  await db.execute("ALTER TABLE entry_item DROP COLUMN completion_was_flagged");
  await db.execute("UPDATE app_meta SET value='13' WHERE key='schema_version'");
  const path = await runManualBackup(db, fs.backupFs, "/w", now, fs.verifyCopy),
    name = path.split("/").at(-1)!;
  expect(await inspectBackup(fs, "/w", name)).toMatchObject({ ok: true, schemaVersion: 13 });
  await db.close();
  await restoreFromBackup(fs, "/w", name, now);
  const restored = await openJournalAt(fs, "/w", () => now);
  expect(
    (await new JournalRepository(restored, () => now).listCategories()).categories.map((c) => c.name),
  ).toEqual(["가상 복원 업무"]);
  expect(await inspectBackup(fs, "/w", name)).toMatchObject({ ok: true, schemaVersion: 13 });
  await restored.close();
});
it("v13 정책 배타 저장은 교착 없이 캐시를 갱신하고 다른 쓰기를 순서대로 처리", async () => {
  const { db, repo } = await setup();
  const events: string[] = [];
  await Promise.all([
    repo.exclusiveWithSettings(async (save) => {
      await save({ backup: { ...RECOMMENDED_BACKUP_POLICY, retentionDays: 90 } });
      expect((await repo.getSettings()).backup.retentionDays).toBe(90);
      events.push("policy");
    }),
    repo.createCategory("가상 동시 기록", "2026-W45").then(() => events.push("write")),
  ]);
  expect(events).toEqual(["policy", "write"]);
  await db.close();
});

it("v13 파손 월간은 정상 사본 생성을 막지 않고 보조 백업도 보류 중 생성만 수행", async () => {
  const { fs, db } = await setup();
  fs.writeFile("/w/backups/work-journey_2026-11_monthly.db", new Uint8Array([1, 2]));
  const created = await runAutoBackup(db, fs.backupFs, "/w", now, { daily: 14, monthly: 12 }, fs.verifyCopy);
  expect(created.monthly).not.toBeNull();
  expect(fs.listAll()).toContain("/w/backups/work-journey_2026-11_monthly.db");
  for (let d = 1; d <= 5; d++)
    await runMirrorBackup(db, fs.backupFs, "/mirror", new Date(2026, 10, d), fs.verifyCopy, true);
  expect(
    (await fs.backupFs.list("/mirror")).filter((n) => parseBackupName(n)?.kind === "daily"),
  ).toHaveLength(5);
  await db.close();
});

it("v13 동일 파일명이 다른 공간에 있어도 정리 계획을 재사용하지 않음", async () => {
  const { fs, db } = await setup();
  for (let d = 1; d <= 3; d++)
    await runAutoBackup(
      db,
      fs.backupFs,
      "/w",
      new Date(2026, 10, d),
      { daily: 14, monthly: 0 },
      fs.verifyCopy,
    );
  const p = await previewBackupCleanup(
    fs.backupFs,
    "/w/backups",
    { ...RECOMMENDED_BACKUP_POLICY, retentionDays: 1 },
    now,
  );
  await expect(executeBackupCleanup(fs.backupFs, "/other/backups", p)).rejects.toThrow("워크스페이스");
  expect(p.candidates.length).toBeGreaterThan(0);
  await db.close();
});
