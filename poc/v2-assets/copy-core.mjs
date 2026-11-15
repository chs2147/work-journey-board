// 원본 일지 읽기·이미지 분리 — 순수 핵심(Node 가져오기 없음, docs/v2-design/84).
// Node 껍데기(db18.mjs captureWorkspace·connected-copy.mjs)와 Preview 앱(src/v2/migration)이 같은 규칙을 쓴다.
// db 인자는 prepare(sql).get()/.all() 만 쓰는 읽기 전용 연결(node:sqlite DatabaseSync 또는 sql.js 어댑터).
import { KANBAN_CTX_REST } from "../v2-migration/workspace-map-core.mjs";

export const SUPPORTED_SCHEMAS = Object.freeze([18, 19, 20]);
export const COPY_FORMAT = "v2-connected-copy-poc-1";

export function noInlineImages(value, knownPayloads = []) {
  if (value instanceof Uint8Array) throw Error("BINARY_IN_METADATA");
  if (typeof value === "string") {
    if (/data\s*:\s*image\//i.test(value) || knownPayloads.some((data) => value.includes(data)))
      throw Error("INLINE_IMAGE_IN_METADATA");
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) noInlineImages(child, knownPayloads);
  }
}

/** hash: 정준 JSON SHA-256(문자열·바이트는 그대로), randomUUID, base64ToBytes/bytesToBase64 */
export function createCopyCore({ hash, randomUUID, base64ToBytes, bytesToBase64 }) {
  if ([hash, randomUUID, base64ToBytes, bytesToBase64].some((f) => typeof f !== "function"))
    throw TypeError("COPY_CORE_DEPS");
  function schema(db) {
    return db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all();
  }
  /**
   * 구조 비교용 모형(C-5 실기에서 바꿈): 원문 글자 대신 의미로 비교한다 — 오래 쓴 일지는 판을 거치며(ALTER) 표 정의 글자의
   * 공백·따옴표가 달라질 수 있다. 표 = 열(이름·형식·NOT NULL·기본값·기본 키)·외래 키, 색인·트리거·뷰 = 주석·공백·식별자 따옴표를 뺀 정의.
   */
  function schemaModel(db) {
    const norm = (sql) =>
      String(sql ?? "")
        .replace(/--[^\n]*/g, " ")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/["`[\]]/g, "")
        .replace(/\s+/g, " ")
        .replace(/\s*([(),;=])\s*/g, "$1")
        .trim();
    const q = (n) => '"' + n.replaceAll('"', '""') + '"';
    const model = {};
    for (const o of schema(db)) {
      if (o.type === "table") {
        const cols = db
          .prepare(`PRAGMA table_info(${q(o.name)})`)
          .all()
          .map((c) =>
            [
              c.name,
              String(c.type ?? "")
                .trim()
                .toUpperCase(),
              c.notnull,
              norm(c.dflt_value),
              c.pk,
            ].join("|"),
          )
          .sort();
        const fks = db
          .prepare(`PRAGMA foreign_key_list(${q(o.name)})`)
          .all()
          .map((f) => [f.table, f.from, f.to, f.on_update, f.on_delete].join("|"))
          .sort();
        model[`table:${o.name}`] = { cols, fks };
      } else model[`${o.type}:${o.name}`] = { on: o.tbl_name, sql: norm(o.sql) };
    }
    return model;
  }
  /** 다른 곳 목록(이름만 — 기록 내용 없음): "table:x 없음" · "table:x 열 c 다름" … */
  function schemaDiff(actual, expected) {
    const out = [];
    for (const k of Object.keys(expected).sort()) {
      if (!(k in actual)) out.push(`${k} 없음`);
      else if (hash(actual[k]) !== hash(expected[k])) {
        if (k.startsWith("table:")) {
          const name = (r) => r.split("|")[0];
          const a = new Map(actual[k].cols.map((r) => [name(r), r])),
            e = new Map(expected[k].cols.map((r) => [name(r), r]));
          for (const [c, r] of e)
            if (!a.has(c)) out.push(`${k} 열 ${c} 없음`);
            else if (a.get(c) !== r) out.push(`${k} 열 ${c} 다름`);
          for (const c of a.keys()) if (!e.has(c)) out.push(`${k} 열 ${c} 더 있음`);
          if (hash(actual[k].fks) !== hash(expected[k].fks)) out.push(`${k} 외래 키 다름`);
        } else out.push(`${k} 다름`);
      }
    }
    for (const k of Object.keys(actual).sort()) if (!(k in expected)) out.push(`${k} 더 있음`);
    return out;
  }
  function rows(db) {
    const out = {};
    for (const { name } of db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()) {
      const q = '"' + name.replaceAll('"', '""') + '"';
      out[name] = db
        .prepare(`SELECT * FROM ${q}`)
        .all()
        .map((r) => {
          const row = { ...r };
          return [hash(row), row];
        })
        // 16진 해시라 바이트 비교 = 예전 localeCompare 순서(ICU·언어 설정과 무관하게)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, row]) => row);
    }
    return out;
  }
  function validate(data, { allowNoteImages = false } = {}) {
    const entries = new Set(data.entry_item.map((r) => r.id));
    function board(row, kind) {
      const doc = JSON.parse(row.doc);
      if (doc.v !== 1 || !Array.isArray(doc.boxes)) throw Error("DOCUMENT_FORMAT");
      const ids = new Set(doc.boxes.map((b) => b.id));
      if (ids.size !== doc.boxes.length) throw Error("DUPLICATE_BOX");
      for (const b of doc.boxes) {
        if (b.asset) {
          const a = (kind === "week" ? data.note_asset : data.cabi_asset).find((a) => a.id === b.asset);
          if (
            !a ||
            (kind === "week" ? a.week_id !== row.week_id : a.owner_kind !== "board" || a.owner_id !== row.id)
          )
            throw Error("ASSET_OWNER");
        }
      }
      for (const e of doc.edges ?? []) if (!ids.has(e.from) || !ids.has(e.to)) throw Error("EDGE_REFERENCE");
      const links =
        kind === "week"
          ? data.note_entry_link.filter((l) => l.note_week_id === row.week_id)
          : data.cabi_entry_link.filter((l) => l.board_id === row.id);
      for (const l of links)
        if (!ids.has(l.box_id) || !entries.has(l.entry_id)) throw Error("LINK_REFERENCE");
    }
    for (const r of data.week_note) board(r, "week");
    for (const r of data.cabi_board) board(r, "board");
    function note(n, ownerId) {
      if (n.type === "image") {
        if (!allowNoteImages) throw Error("NOTE_IMAGE_UNSUPPORTED");
        const asset = data.cabi_asset.find((a) => a.id === n.attrs?.asset);
        if (!asset || asset.owner_kind !== "note" || asset.owner_id !== ownerId)
          throw Error("NOTE_IMAGE_OWNER");
      }
      for (const c of n.content ?? []) note(c, ownerId);
    }
    for (const r of data.cabi_note) note(JSON.parse(r.content), r.id);
  }
  /**
   * 열린 원본 연결에서 행을 읽고 검사한다(쓰기 없음). expectedSchema(version) = 그 판의 제품 마이그레이션만 적용한
   * 빈 DB의 schemaModel — 원본 구조가 의미상 같아야 한다(다르면 SCHEMA_UNSUPPORTED + details = 다른 곳 이름).
   */
  function captureRows(db, { expectedVersion, expectedSchema, ...options } = {}) {
    const rawVersion = db.prepare("SELECT value FROM app_meta WHERE key='schema_version'").get()?.value;
    const version = SUPPORTED_SCHEMAS.map(String).includes(rawVersion) ? Number(rawVersion) : NaN;
    if (
      !SUPPORTED_SCHEMAS.includes(version) ||
      (expectedVersion !== undefined && expectedVersion !== version)
    )
      throw Error("SCHEMA_VERSION");
    const diff = schemaDiff(schemaModel(db), expectedSchema(version));
    if (diff.length) throw Object.assign(Error("SCHEMA_UNSUPPORTED"), { details: diff.slice(0, 20) });
    if (db.prepare("PRAGMA journal_mode").get().journal_mode !== "delete") throw Error("SOURCE_NOT_FROZEN");
    if (
      db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length
    )
      throw Error("DB_INTEGRITY");
    const result = rows(db);
    if (version >= 19 && result.cabi_note.some((r) => ![0, 1].includes(r.delete_locked)))
      throw Error("DB_INTEGRITY");
    if (version >= 20) {
      const ctx = result.kanban_ctx;
      if (ctx.length !== 1 || hash(ctx[0]) !== hash({ ...KANBAN_CTX_REST }))
        throw Error("KANBAN_WRITE_IN_PROGRESS");
    }
    validate(result, options);
    return result;
  }
  /**
   * 이미지 base64를 떼어 내 참조로 바꾼 사본(메모리). 결과 모양 = inspectConnectedCopy와 같음
   * { manifest, records:[{table_name,ordinal,value}], blobs:[{id,bytes,object_id,object_key}] } + blobBytes(Map id→바이트)
   */
  function extractCopy(captured, { workspaceId, sourceWorkspaceId }) {
    const rows = structuredClone(captured.rows),
      blobs = new Map(),
      knownPayloads = [];
    let references = 0;
    for (const table of ["note_asset", "cabi_asset"])
      for (const row of rows[table]) {
        for (const field of ["data", "thumb"]) {
          const encoded = row[field];
          delete row[field];
          row[field + "Ref"] = null;
          if (encoded === null) continue;
          if (typeof encoded !== "string") throw Error("ASSET_ENCODING");
          const bytes = base64ToBytes(encoded);
          if (
            !bytes.length ||
            bytesToBase64(bytes) !== encoded ||
            (field === "data" && bytes.length !== row.bytes)
          )
            throw Error("ASSET_ENCODING");
          knownPayloads.push(encoded);
          const id = hash(bytes);
          if (!blobs.has(id)) blobs.set(id, { bytes, objectId: randomUUID() });
          const objectKey = `${workspaceId}/${blobs.get(id).objectId}`;
          row[field + "Ref"] = { blob: id, bytes: bytes.length, storeId: "supabase-private", objectKey };
          references++;
        }
      }
    noInlineImages(rows, knownPayloads);
    const byte = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const records = [];
    for (const table of Object.keys(rows).sort(byte))
      rows[table].forEach((row, i) =>
        records.push({ table_name: table, ordinal: i, value: JSON.stringify(row) }),
      );
    const blobRows = [...blobs]
      .sort(([a], [b]) => byte(a, b))
      .map(([id, b]) => ({
        id,
        bytes: b.bytes.length,
        object_id: b.objectId,
        object_key: `${workspaceId}/${b.objectId}`,
      }));
    const manifest = {
      format: COPY_FORMAT,
      sourceSchema: Number(rows.app_meta.find((r) => r.key === "schema_version").value),
      sourceWorkspaceId,
      workspaceId,
      sourceHash: captured.sourceHash,
      phase: "local-extracted-not-uploaded",
      sourceRows: Object.fromEntries(Object.entries(rows).map(([t, r]) => [t, r.length])),
      assetReferences: references,
      uniqueFiles: blobs.size,
      recordHash: hash(records),
      blobHash: hash(blobRows),
    };
    noInlineImages({ manifest, records, blobs: blobRows }, knownPayloads);
    return {
      manifest,
      records,
      blobs: blobRows,
      blobBytes: new Map([...blobs].map(([id, b]) => [id, b.bytes])),
      knownPayloads,
    };
  }
  return Object.freeze({ captureRows, extractCopy, schema, schemaModel, schemaDiff, rows, validate });
}
