import Database from "@tauri-apps/plugin-sql";
import type { SqlDriver, SqlParam } from "../driver";

/**
 * 실앱 드라이버: tauri-plugin-sql(SQLite). 사용자가 고른 폴더의 절대 경로 DB를 연다(I-M0에서 확인).
 * 주의: 플러그인 내부가 연결 풀이라 BEGIN/COMMIT을 따로 보내면 다른 연결로 갈 수 있다 →
 * 트랜잭션 처리는 S2에서 별도로 설계한다(i-m1-plan S2).
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
    async close() {
      await db.close(url);
    },
  };
}
