// 브라우저 모드·테스트용 가짜 파일 시스템. 실제 폴더 대신 메모리에 경로 → DB 바이트를 둔다.
// 실앱(Tauri)과 같은 인터페이스(stat·백업 폴더 동작·DB 열기)를 흉내 내 첫 실행·저장 위치 변경 흐름을 리눅스에서 시험한다.
import { isDeletableByApp, type BackupFs, type VerifyCopy } from "../data/backup";
import type { SqlDriver, SqlParam } from "../data/driver";
import type { SqlJsDriver } from "../data/drivers/sqlJs";
import type { PathInfo } from "./index";

export type OpenSqlJs = (bytes?: Uint8Array, label?: string) => Promise<SqlJsDriver>;

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
const parentOf = (p: string) => norm(p).slice(0, norm(p).lastIndexOf("/")) || "/";
const nameOf = (p: string) => norm(p).slice(norm(p).lastIndexOf("/") + 1);

export interface FakeFs {
  join(...parts: string[]): string;
  stat(path: string): Promise<PathInfo>;
  ensureDir(path: string): Promise<void>;
  copyNew(from: string, to: string): Promise<void>;
  openDatabase(path: string): Promise<SqlDriver>;
  verifyCopy: VerifyCopy;
  backupFs: BackupFs;
  /** 테스트 준비용: 일반 파일 하나 만들기 */
  writeFile(path: string, bytes?: Uint8Array): void;
  /** 테스트 확인용: 경로 목록 */
  listAll(): string[];
}

export function createFakeFs(open: OpenSqlJs): FakeFs {
  const dirs = new Set<string>(["/"]);
  const files = new Map<string, Uint8Array>();
  const live = new Map<string, SqlJsDriver>();

  const ensureDirSync = (dir: string) => {
    let d = norm(dir);
    while (d && !dirs.has(d)) {
      dirs.add(d);
      d = parentOf(d);
    }
  };
  const exists = (p: string) => files.has(norm(p)) || live.has(norm(p)) || dirs.has(norm(p));
  const bytesOf = (p: string) => live.get(norm(p))?.exportBytes() ?? files.get(norm(p));

  const join = (...parts: string[]) =>
    parts
      .filter(Boolean)
      .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
      .join("/");

  /** VACUUM INTO를 가로채 현재 DB 바이트를 가짜 파일로 쓴다(대상이 있으면 SQLite처럼 실패). */
  const wrap = (path: string, d: SqlJsDriver): SqlDriver => ({
    label: path,
    async execute(sql: string, params?: SqlParam[]) {
      const m = /^VACUUM INTO '(.+)'$/s.exec(sql.trim());
      if (!m) return d.execute(sql, params);
      const target = norm(m[1]!.replace(/''/g, "'"));
      if (!dirs.has(parentOf(target))) throw new Error(`unable to open database: ${target}`);
      if (exists(target)) throw new Error(`output file already exists: ${target}`);
      files.set(target, d.exportBytes());
      return { changes: 0 };
    },
    select: (sql, params) => d.select(sql, params),
    batch: (s) => d.batch(s),
    async close() {
      files.set(norm(path), d.exportBytes());
      live.delete(norm(path));
      await d.close();
    },
  });

  const backupFs: BackupFs = {
    join,
    ensureDir: async (dir) => ensureDirSync(dir),
    list: async (dir) =>
      [...new Set([...files.keys(), ...live.keys()])]
        .filter((p) => parentOf(p) === norm(dir))
        .map(nameOf)
        .sort(),
    rename: async (from, to) => {
      const b = bytesOf(from);
      if (!b) throw new Error(`없는 파일: ${from}`);
      files.set(norm(to), b);
      files.delete(norm(from));
    },
    remove: async (path) => {
      if (!isDeletableByApp(nameOf(path))) throw new Error(`삭제 금지 파일: ${path}`); // 실앱 Rust 가드와 같은 규칙
      files.delete(norm(path));
    },
  };

  return {
    join,
    async stat(path) {
      const p = norm(path);
      if (dirs.has(p)) return { exists: true, isDir: true, size: null };
      const b = bytesOf(p);
      return b ? { exists: true, isDir: false, size: b.length } : { exists: false, isDir: false, size: null };
    },
    ensureDir: async (dir) => ensureDirSync(dir),
    async copyNew(from, to) {
      if (exists(to)) throw new Error(`이미 있는 파일: ${to}`);
      const b = bytesOf(from);
      if (!b) throw new Error(`없는 파일: ${from}`);
      files.set(norm(to), b);
    },
    async openDatabase(path) {
      const p = norm(path);
      if (!dirs.has(parentOf(p))) throw new Error(`unable to open database file: ${p}`);
      let d = live.get(p);
      if (!d) {
        d = await open(files.get(p), p);
        live.set(p, d);
        files.delete(p);
      }
      return wrap(p, d);
    },
    async verifyCopy(path) {
      const b = bytesOf(path);
      if (!b) return false;
      const d = await open(b);
      try {
        const rows = await d.select<{ quick_check: string }>("PRAGMA quick_check");
        return rows[0]?.quick_check === "ok";
      } finally {
        await d.close();
      }
    },
    backupFs,
    writeFile(path, bytes = new Uint8Array([1])) {
      ensureDirSync(parentOf(path));
      files.set(norm(path), bytes);
    },
    listAll: () => [...new Set([...files.keys(), ...live.keys()])].sort(),
  };
}
