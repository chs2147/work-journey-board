// 개선 v22(improve-v22-spec 2절): 앱과 호환되지 않는(새 DB 버전) 일지는 열지 않는다 — 연결 설정·검사·쓰기 0. 가상 일지만.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BACKUP_DIR, DATA_FILE } from "../../src/data/backup";
import type { SqlDriver } from "../../src/data/driver";
import { openSqlJs } from "../../src/data/drivers/sqlJs";
import { LATEST_SCHEMA_VERSION, NewerSchemaError, readSchemaVersion } from "../../src/data/migrate";
import { copyIncompatibleForUpdate, openJournalAt, preUpdateBackupClosed } from "../../src/data/session";
import { createFakeFs } from "../../src/platform/fakeFs";

const now = () => new Date(2026, 10, 12, 9, 30);

/** 일지를 만든 뒤 DB 버전을 99로(다른 PC의 최신 앱이 올린 상황) — 열 때 실행된 문장을 모두 기록 */
async function newerJournal() {
  const fs = createFakeFs((bytes, label) => openSqlJs(undefined, bytes, label));
  await fs.ensureDir("/w");
  const d = await openJournalAt(fs, "/w", now);
  await d.execute("UPDATE app_meta SET value = '99' WHERE key = 'schema_version'");
  await d.close();
  const log: string[] = [];
  const spy = {
    ...fs,
    openDatabase: async (path: string): Promise<SqlDriver> => {
      const real = await fs.openDatabase(path);
      return {
        label: real.label,
        execute: (sql, p) => (log.push(sql), real.execute(sql, p)),
        select: (sql, p) => (log.push(sql), real.select(sql, p)),
        batch: (st) => (log.push(...st.map((x) => x.sql)), real.batch(st)),
        close: () => real.close(),
      };
    },
  };
  return { fs, spy, log };
}

describe("앱과 호환되지 않는 일지(improve-v22-spec 2-1)", () => {
  it("DB 버전만 읽고 바로 닫음 — PRAGMA·무결성 검사·쓰기 문장 없음", async () => {
    const { spy, log } = await newerJournal();
    const err = await openJournalAt(spy, "/w", now).catch((e) => e);
    expect(err).toBeInstanceOf(NewerSchemaError);
    expect(err).toMatchObject({ fileVersion: 99, supported: LATEST_SCHEMA_VERSION });
    expect(err.message).toContain("호환되지 않습니다");
    expect(log.length).toBeGreaterThan(0);
    for (const sql of log) expect(sql.trim().toUpperCase()).toMatch(/^SELECT /);
    expect(log.join("\n")).not.toMatch(/PRAGMA|INSERT|UPDATE|DELETE|CREATE|ALTER|VACUUM/i);
  });

  it("업데이트 전 백업은 연결 없이 파일 복사(_pre-update, DB 버전 그대로) · 다른 공간 백업도 같은 길", async () => {
    const { fs, spy, log } = await newerJournal();
    const name = await copyIncompatibleForUpdate(spy, "/w", now());
    expect(name).toMatch(/_pre-update_app-v.+_db-v99\.db$/);
    expect(fs.listAll()).toContain(`/w/${BACKUP_DIR}/${name}`);
    log.length = 0;
    expect(await preUpdateBackupClosed(spy, "/w", now())).toBe(true);
    expect(log.join("\n")).not.toMatch(/PRAGMA|VACUUM|INSERT|UPDATE/i);
    expect(fs.listAll().filter((p) => p.includes("_pre-update_"))).toHaveLength(2);
    // 원본 일지는 그대로 v99
    const d = await fs.openDatabase(`/w/${DATA_FILE}`);
    expect(await readSchemaVersion(d)).toBe(99);
    await d.close();
  });
});
