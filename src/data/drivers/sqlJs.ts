import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { SqlDriver, SqlParam, SqlStatement } from "../driver";

let sqlJs: Promise<SqlJsStatic> | null = null;

/**
 * sql.js(SQLite WASM) 메모리 DB. 개발·테스트·브라우저 모드용.
 * @param wasmUrl 브라우저에서 wasm 파일 위치(Vite `?url` import). Node(테스트)에서는 생략.
 */
export async function openSqlJsMemory(wasmUrl?: string): Promise<SqlDriver> {
  return openSqlJs(wasmUrl);
}

/** sql.js DB를 연다. bytes를 주면 그 내용(다른 DB 파일의 사본)으로 시작한다. */
export async function openSqlJs(wasmUrl?: string, bytes?: Uint8Array, label?: string): Promise<SqlJsDriver> {
  sqlJs ??= initSqlJs(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  const SQL = await sqlJs;
  return new SqlJsDriver(new SQL.Database(bytes), label);
}

/** 브라우저 모드 조회·쓰기 호출 수(실앱의 IPC 왕복 수에 해당) — 성능 측정용(optimize-1031-plan O1) */
export const sqlJsCalls = { n: 0 };

export class SqlJsDriver implements SqlDriver {
  constructor(
    private readonly db: Database,
    readonly label: string = "브라우저 모드(sql.js 메모리)",
  ) {
    db.run("PRAGMA foreign_keys = ON");
  }

  /** DB 전체를 바이트로(브라우저 모드의 가짜 파일 시스템용) */
  exportBytes(): Uint8Array {
    const bytes = this.db.export();
    // sql.js export()는 연결 설정(PRAGMA)을 기본값으로 되돌린다 — 외래 키 검사를 다시 켠다(실앱 sqlx는 늘 켜짐)
    this.db.run("PRAGMA foreign_keys = ON");
    return bytes;
  }

  async execute(sql: string, params: SqlParam[] = []) {
    sqlJsCalls.n++;
    this.run(sql, params);
    return { changes: this.db.getRowsModified() };
  }

  async select<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    sqlJsCalls.n++;
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

  async batch(statements: SqlStatement[]) {
    sqlJsCalls.n++;
    let changes = 0;
    this.db.run("BEGIN");
    try {
      for (const s of statements) {
        this.run(s.sql, s.params ?? []);
        changes += this.db.getRowsModified();
      }
      this.db.run("COMMIT");
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    }
    return changes;
  }

  async close() {
    this.db.close();
  }

  private run(sql: string, params: SqlParam[]) {
    // 매개변수가 없으면 run()이 여러 문장을 모두 실행한다(있으면 첫 문장만 준비됨).
    if (params.length) this.db.run(sql, params);
    else this.db.run(sql);
  }
}
