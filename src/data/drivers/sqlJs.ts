import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { SqlDriver, SqlParam } from "../driver";

let sqlJs: Promise<SqlJsStatic> | null = null;

/**
 * sql.js(SQLite WASM) 메모리 DB. 개발·테스트·브라우저 모드용.
 * @param wasmUrl 브라우저에서 wasm 파일 위치(Vite `?url` import). Node(테스트)에서는 생략.
 */
export async function openSqlJsMemory(wasmUrl?: string): Promise<SqlDriver> {
  sqlJs ??= initSqlJs(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  const SQL = await sqlJs;
  return new SqlJsDriver(new SQL.Database());
}

class SqlJsDriver implements SqlDriver {
  readonly label = "브라우저 모드(sql.js 메모리)";

  constructor(private readonly db: Database) {
    db.run("PRAGMA foreign_keys = ON");
  }

  async execute(sql: string, params: SqlParam[] = []) {
    this.db.run(sql, params);
    return { changes: this.db.getRowsModified() };
  }

  async select<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  async close() {
    this.db.close();
  }
}
