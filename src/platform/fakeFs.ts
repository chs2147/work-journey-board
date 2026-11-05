// 브라우저 모드·테스트용 가짜 파일 시스템. 실제 폴더 대신 메모리에 경로 → DB 바이트를 둔다.
// 실앱(Tauri)과 같은 인터페이스(stat·백업 폴더 동작·DB 열기)를 흉내 내 첫 실행·저장 위치 변경 흐름을 리눅스에서 시험한다.
import {
  BACKUP_DIR,
  DATA_FILE,
  isBeforeRestoreName,
  isDeletableByApp,
  isRestorableName,
  type BackupFs,
  type VerifyCopy,
} from "../data/backup";
import { quickCheck, readSchemaVersion, backupStructureMatches } from "../data/migrate";
import type { SqlDriver, SqlParam } from "../data/driver";
import type { SqlJsDriver } from "../data/drivers/sqlJs";
import type { FsEntry } from "../domain/cabinet";
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
  restoreJournal(dataDir: string, backupName: string, beforeName: string): Promise<void>;
  /** 테스트 준비용: 일반 파일 하나 만들기(수정 시각 ms는 선택) */
  writeFile(path: string, bytes?: Uint8Array, modified?: number): void;
  /** Cabinet 폴더 창 흉내(features-1102-spec F5): 폴더 안 이름·종류·크기·수정 시각 */
  listDir(path: string): FsEntry[];
  /** 그 경로가 폴더인가 */
  isDir(path: string): boolean;
  /** 테스트용: 폴더·파일 이름 바꾸기·옮기기(탐색기에서 바꾼 흉내, improve-1102v7 K4·K5) */
  movePath(from: string, to: string): void;
  /** 테스트 확인용: 경로 목록 */
  listAll(): string[];
}

export function createFakeFs(open: OpenSqlJs): FakeFs {
  const dirs = new Set<string>(["/"]);
  const files = new Map<string, Uint8Array>();
  const live = new Map<string, SqlJsDriver>();
  const mtimes = new Map<string, number>();

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
      mtimes.set(target, Date.now());
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

  const stat: FakeFs["stat"] = async (path) => {
    const p = norm(path);
    if (dirs.has(p)) return { exists: true, isDir: true, size: null, modified: null, isSymlink: false };
    const b = bytesOf(p);
    return {
      exists: !!b,
      isDir: false,
      size: b?.length ?? null,
      modified: mtimes.get(p) ?? null,
      isSymlink: false,
    };
  };
  const backupFs: BackupFs = {
    stat,
    async inspect(path) {
      const bytes = bytesOf(path);
      if (!bytes) return { ok: false, schema: null };
      let d: SqlDriver | undefined;
      try {
        d = await open(bytes);
        const schema = await readSchemaVersion(d);
        return { ok: (await quickCheck(d)) && (await backupStructureMatches(d, schema)), schema };
      } catch {
        return { ok: false, schema: null };
      } finally {
        await d?.close();
      }
    },
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
      mtimes.set(norm(to), mtimes.get(norm(from)) ?? Date.now());
      files.delete(norm(from));
      mtimes.delete(norm(from));
    },
    remove: async (path) => {
      if (!isDeletableByApp(nameOf(path))) throw new Error(`삭제 금지 파일: ${path}`); // 실앱 Rust 가드와 같은 규칙
      files.delete(norm(path));
    },
  };

  return {
    join,
    stat,
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
    // 실앱 Rust restore_journal과 같은 규칙: 이름 검사 → 지금 일지를 backups\<before>로 옮김 → 백업을 새 일지로 복사(실패하면 되돌림)
    async restoreJournal(dataDir, backupName, beforeName) {
      if (!isRestorableName(backupName) || !isBeforeRestoreName(beforeName))
        throw new Error(`허용되지 않은 복원: ${backupName} → ${beforeName}`);
      const journal = join(dataDir, DATA_FILE);
      const backup = join(dataDir, BACKUP_DIR, backupName);
      const before = join(dataDir, BACKUP_DIR, beforeName);
      if (live.has(norm(journal))) throw new Error("일지가 열려 있습니다");
      const src = bytesOf(backup);
      if (!src) throw new Error(`없는 백업: ${backupName}`);
      if (exists(before)) throw new Error(`이미 있는 파일: ${beforeName}`);
      const cur = bytesOf(journal);
      if (cur) {
        files.set(norm(before), cur);
        files.delete(norm(journal));
      }
      files.set(norm(journal), src.slice());
    },
    writeFile(path, bytes = new Uint8Array([1]), modified) {
      ensureDirSync(parentOf(path));
      files.set(norm(path), bytes);
      if (modified != null) mtimes.set(norm(path), modified);
    },
    listDir(path) {
      const d = norm(path);
      if (!dirs.has(d)) throw new Error(`폴더가 아닙니다: ${path}`);
      const sub = [...dirs].filter((x) => x !== d && parentOf(x) === d);
      const fl = [...new Set([...files.keys(), ...live.keys()])].filter((x) => parentOf(x) === d);
      return [
        ...sub.map((x) => ({
          name: nameOf(x),
          dir: true,
          size: null,
          modified: mtimes.get(x) ?? null,
          hidden: nameOf(x).startsWith("."),
        })),
        ...fl.map((x) => ({
          name: nameOf(x),
          dir: false,
          size: bytesOf(x)?.length ?? 0,
          modified: mtimes.get(x) ?? null,
          hidden: nameOf(x).startsWith("."),
        })),
      ];
    },
    isDir: (path) => dirs.has(norm(path)),
    movePath(from, to) {
      const [f, t] = [norm(from), norm(to)];
      const re = (p: string) => (p === f ? t : p.startsWith(`${f}/`) ? t + p.slice(f.length) : null);
      for (const d of [...dirs]) {
        const n = re(d);
        if (n) {
          dirs.delete(d);
          dirs.add(n);
        }
      }
      for (const [k, v] of [...files]) {
        const n = re(k);
        if (n) {
          files.delete(k);
          files.set(n, v);
          const m = mtimes.get(k);
          if (m != null) mtimes.set(n, m);
        }
      }
      ensureDirSync(parentOf(t));
    },
    listAll: () => [...new Set([...files.keys(), ...live.keys()])].sort(),
  };
}
