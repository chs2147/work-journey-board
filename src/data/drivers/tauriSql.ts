import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type { SqlDriver, SqlParam, SqlStatement } from "../driver";

/**
 * 실앱 드라이버: tauri-plugin-sql(SQLite). 사용자가 고른 폴더의 절대 경로 DB를 연다(I-M0에서 확인).
 * 플러그인 내부는 연결 풀이므로 트랜잭션은 Rust `db_batch` 명령(sqlx Transaction — 실패 시 자동 롤백)으로 처리한다.
 */
export async function openTauriSql(dbPath: string): Promise<SqlDriver> {
  const url = `sqlite:${dbPath}`;
  const db = await Database.load(url);
  return {
    label: dbPath,
    async execute(sql: string, params: SqlParam[] = []) {
      const r = await db.execute(sql, params);
      return { changes: r.rowsAffected };
    },
    async select<T>(sql: string, params: SqlParam[] = []) {
      return db.select<T[]>(sql, params);
    },
    async batch(statements: SqlStatement[]) {
      return invoke<number>("db_batch", {
        db: url,
        statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
      });
    },
    async close() {
      await db.close(url);
    },
  };
}
