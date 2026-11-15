// 온라인 형식 → 앱 일지(구조 v18~20) 되살리기 — 순수 핵심(Node 가져오기 없음, docs/v2-design/87 D-3).
// workspace-map-core의 역방향. 온라인에 보내지 않은 것(이 기기 설정·폴더 경로 등)은 되살리지 않는다(빈 값·기본값).
// 그림 본문은 getAsset(objectId) → 바이트로 받아 SHA-256을 확인한 뒤 base64로(메모리 안 일지에서만).
import { KANBAN_CTX_REST } from "./workspace-map-core.mjs";

const assetTables = new Set(["note_asset", "cabi_asset"]);
export const UNBOUND_FOLDER = "wjb-online:device-local-unbound";

export function createWorkspaceRestorer({ hash, bytesToBase64 }) {
  if (typeof hash !== "function" || typeof bytesToBase64 !== "function") throw TypeError("RESTORE_DEPS");
  /** 봉투(머리 + 기록) → 표별 행. 그림 참조 → base64(크기·해시 확인) */
  function toRows({ header, records }, getAsset) {
    const version = header.sourceSchema;
    if (![18, 19, 20].includes(version)) throw Error("RESTORE_SCHEMA_VERSION");
    const assets = new Map(header.assets.map((a) => [a.objectId, a]));
    const out = {};
    for (const r of records) {
      const row = structuredClone(r.value);
      if (r.table === "cabinet_item" && "targetState" in row) {
        if (row.targetState !== "device-local-unbound" || row.target !== null) throw Error("RESTORE_FORMAT");
        delete row.targetState;
        // 폴더 경로는 기기마다 달라 온라인에 보내지 않았다 — 로컬 칸은 비울 수 없어 자리표시(절대 경로가 아니라
        // Cabinet Rust 검사가 열기를 거절한다 → 앱에서는 없는 폴더 = "경로 다시 지정")
        row.target = UNBOUND_FOLDER;
      }
      if (assetTables.has(r.table))
        for (const field of ["data", "thumb"]) {
          const ref = row[field + "Ref"];
          delete row[field + "Ref"];
          if (ref === null || ref === undefined) {
            row[field] = null;
            continue;
          }
          const a = assets.get(ref.objectId);
          if (!a || a.sha256 !== ref.sha256 || a.bytes !== ref.bytes) throw Error("RESTORE_ASSET_REFERENCE");
          const bytes = getAsset(ref.objectId);
          if (!bytes || bytes.length !== ref.bytes || hash(bytes) !== ref.sha256)
            throw Error("RESTORE_ASSET_MISMATCH");
          row[field] = bytesToBase64(bytes);
        }
      (out[r.table] ??= []).push(row);
    }
    out.app_meta ??= [];
    if (out.app_meta.some((m) => m.key === "schema_version")) throw Error("RESTORE_FORMAT");
    out.app_meta.push({ key: "schema_version", value: String(version) });
    if (version >= 20) {
      if (out.kanban_ctx?.length) throw Error("RESTORE_FORMAT");
      out.kanban_ctx = [{ ...KANBAN_CTX_REST }];
    }
    return out;
  }
  /**
   * 행을 빈 일지(제품 마이그레이션만 적용한 같은 판)에 넣는다. db = prepare(sql).run/all, exec 를 가진 연결.
   * 트리거를 잠시 빼고 넣은 뒤 그대로 다시 만든다(되살리기가 상태 이력 등을 새로 만들지 않게). 외래 키 확인.
   */
  function writeInto(db, rows) {
    const q = (s) => '"' + s.replaceAll('"', '""') + '"';
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name);
    for (const t of Object.keys(rows)) if (!tables.includes(t)) throw Error("RESTORE_TABLE_UNKNOWN");
    const triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
    db.exec("PRAGMA foreign_keys=OFF");
    for (const t of triggers) db.exec(`DROP TRIGGER ${q(t.name)}`);
    for (const t of tables) {
      db.exec(`DELETE FROM ${q(t)}`);
      const cols = new Set(
        db
          .prepare(`PRAGMA table_info(${q(t)})`)
          .all()
          .map((c) => c.name),
      );
      for (const r of rows[t] ?? []) {
        const keys = Object.keys(r);
        if (keys.some((k) => !cols.has(k))) throw Error("RESTORE_FIELD_UNKNOWN");
        db.prepare(
          `INSERT INTO ${q(t)}(${keys.map(q).join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
        ).run(...keys.map((k) => r[k]));
      }
    }
    for (const t of triggers) db.exec(t.sql);
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw Error("RESTORE_INTEGRITY");
    db.exec("PRAGMA foreign_keys=ON");
  }
  return Object.freeze({ toRows, writeInto });
}
