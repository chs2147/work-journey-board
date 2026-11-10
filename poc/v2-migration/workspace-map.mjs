// DB18 -> online metadata envelope. Never reads/writes the original DB.
import contract from "./db18-contract.json" with { type: "json" };
import { inspectConnectedCopy } from "../v2-assets/connected-copy.mjs";
import { hash } from "../v2-sync/model.mjs";

export const workspaceMapProfile = "workspace-db18-map-poc-1";
const assetTables = new Set(["note_asset", "cabi_asset"]);
const jsonFields = {
  week_note: ["doc"],
  cabi_board: ["doc"],
  cabi_note: ["content"],
  knowledge_card_source: ["locator_json"],
  import_batch: ["undo_json"],
};
const nodes = new Set([
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "image",
  "text",
]);
const marks = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "fontSize",
  "textColor",
  "highlight",
  "link",
  "code",
]);
function keysEqual(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}
function imageFree(value) {
  if (value instanceof Uint8Array) throw Error("IMAGE_BODY_IN_METADATA");
  if (
    typeof value === "string" &&
    (/data\s*:\s*image\//i.test(value) ||
      /(iVBORw0KGgo|\/9j\/|R0lGOD|UklGR[A-Za-z0-9+/]{6}XRUJQ)/.test(value))
  )
    throw Error("IMAGE_BODY_IN_METADATA");
  if (value && typeof value === "object") for (const child of Object.values(value)) imageFree(child);
}
function json(value) {
  if (typeof value !== "string") throw Error("JSON_FIELD_REQUIRED");
  return JSON.parse(value);
}
function rich(node, owner, assets, depth = 0) {
  if (!node || !nodes.has(node.type) || depth > 32) throw Error("UNKNOWN_DOCUMENT_NODE");
  if (node.type === "image") {
    const a = assets.find(
      (a) => a.id === node.attrs?.asset && a.owner_kind === "note" && a.owner_id === owner,
    );
    if (!a || "src" in (node.attrs || {})) throw Error("NOTE_IMAGE_REFERENCE");
  }
  if (node.content !== undefined && !Array.isArray(node.content)) throw Error("DOCUMENT_CONTENT");
  for (const mark of node.marks || []) {
    if (!marks.has(mark.type)) throw Error("UNKNOWN_DOCUMENT_MARK");
    if (mark.type === "link" && !/^https?:\/\//i.test(mark.attrs?.href || ""))
      throw Error("LOCAL_DOCUMENT_LINK");
  }
  for (const n of node.content || []) rich(n, owner, assets, depth + 1);
}
function board(doc, owner, assetRows, kind) {
  if (doc.v !== 1 || !Array.isArray(doc.boxes)) throw Error("BOARD_FORMAT");
  const ids = new Set(doc.boxes.map((b) => b.id));
  if (ids.size !== doc.boxes.length) throw Error("DUPLICATE_BOX");
  for (const b of doc.boxes) {
    if (!["text", "link", "image"].includes(b.kind)) throw Error("UNKNOWN_BOARD_OBJECT");
    if (b.asset) {
      const a = assetRows.find((a) => a.id === b.asset);
      if (!a || (kind === "week" ? a.week_id !== owner : a.owner_kind !== "board" || a.owner_id !== owner))
        throw Error("BOARD_IMAGE_REFERENCE");
    }
    if (b.kind === "image" && !b.asset) throw Error("BOARD_IMAGE_REFERENCE");
    if (b.kind === "text") rich(b.content, null, []);
    if (b.kind === "link" && !/^https?:\/\//i.test(b.url || "")) throw Error("LOCAL_DOCUMENT_LINK");
    if (b.widget) {
      if (
        !["elapsed", "timeline", "important"].includes(b.widget.type) ||
        Object.keys(b.widget).some(
          (k) => !["type", "basis", "variant", "weeks", "milestoneEntryIds"].includes(k),
        )
      )
        throw Error("UNKNOWN_WIDGET_FORMAT");
    }
    if (b.resource) {
      const r = b.resource;
      if (
        r.kind === "memo"
          ? !keysEqual(r, ["kind", "weekId", "boxId"])
          : !["note", "folder", "link"].includes(r.kind) || !keysEqual(r, ["kind", "id"])
      )
        throw Error("UNKNOWN_RESOURCE_FORMAT");
    }
  }
  for (const e of doc.edges || [])
    if (!ids.has(e.from) || !ids.has(e.to)) throw Error("BOARD_EDGE_REFERENCE");
}
function validateSourceRow(table, row) {
  const cols = contract.tables[table].columns;
  const names = cols
    .map((c) => c.name)
    .filter((n) => !assetTables.has(table) || !["data", "thumb"].includes(n));
  if (assetTables.has(table)) names.push("dataRef", "thumbRef");
  if (!keysEqual(row, names)) throw Error("ROW_COLUMNS_CHANGED");
  for (const c of cols) {
    if (assetTables.has(table) && ["data", "thumb"].includes(c.name)) continue;
    const v = row[c.name];
    if (v === null) {
      if (!c.nullable || c.pk) throw Error("ROW_NULL");
      continue;
    }
    if (c.type === "TEXT" && typeof v !== "string") throw Error("ROW_TYPE");
    if (c.type === "INTEGER" && !Number.isSafeInteger(v)) throw Error("ROW_TYPE");
  }
  imageFree(row);
  for (const field of jsonFields[table] || []) imageFree(json(row[field]));
}
function checkForeignKeys(tables) {
  for (const [name, schema] of Object.entries(contract.tables)) {
    for (const row of tables[name])
      for (const fk of schema.foreignKeys) {
        if (row[fk.from] !== null && !tables[fk.table].some((r) => r[fk.to] === row[fk.from]))
          throw Error("FOREIGN_KEY_REFERENCE");
      }
  }
}
function folderBase(path) {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || "import";
}
function projectSettings(value, exclusions) {
  const s = json(value),
    known = ["workspace", "nudgeWeeks", "backup", "summary", "holiday", "ai", "ui"];
  if (!s || typeof s !== "object" || Array.isArray(s) || Object.keys(s).some((k) => !known.includes(k)))
    throw Error("UNKNOWN_SETTINGS_KEY");
  const out = {};
  for (const k of ["workspace", "nudgeWeeks", "summary", "holiday"]) if (k in s) out[k] = s[k];
  if (out.workspace !== null && out.workspace !== undefined) {
    if (!keysEqual(out.workspace, ["name", "color", "icon", "updatedAt"]))
      throw Error("WORKSPACE_SETTINGS_FORMAT");
    const w = out.workspace;
    if (
      typeof w.name !== "string" ||
      typeof w.color !== "string" ||
      typeof w.icon !== "string" ||
      !Number.isSafeInteger(w.updatedAt)
    )
      throw Error("WORKSPACE_SETTINGS_FORMAT");
  }
  if (out.nudgeWeeks !== undefined && !Number.isInteger(out.nudgeWeeks)) throw Error("SETTINGS_FORMAT");
  if (
    out.summary !== undefined &&
    (!keysEqual(out.summary, ["includeMemo"]) || typeof out.summary.includeMemo !== "boolean")
  )
    throw Error("SETTINGS_FORMAT");
  if (out.holiday !== undefined) {
    const h = out.holiday;
    if (
      !keysEqual(h, ["krEnabled", "off", "company", "reasons"]) ||
      typeof h.krEnabled !== "boolean" ||
      !Array.isArray(h.off) ||
      !Array.isArray(h.company) ||
      !Array.isArray(h.reasons)
    )
      throw Error("SETTINGS_FORMAT");
    if (
      h.off.some((v) => typeof v !== "string") ||
      h.reasons.some((v) => typeof v !== "string") ||
      h.company.some(
        (c) => !keysEqual(c, ["date", "name"]) || typeof c.date !== "string" || typeof c.name !== "string",
      )
    )
      throw Error("SETTINGS_FORMAT");
  }
  for (const k of ["backup", "ai", "ui"])
    if (k in s)
      exclusions.push({ table: "app_meta", key: "settings." + k, reason: "device-preference-not-synced" });
  return JSON.stringify(out);
}
export function mapWorkspace(directory, workspaceId) {
  const copy = inspectConnectedCopy(directory, workspaceId);
  const grouped = Object.fromEntries(Object.keys(contract.tables).map((t) => [t, []]));
  for (const record of copy.records) {
    if (!Object.hasOwn(grouped, record.table_name)) throw Error("TABLE_UNSUPPORTED");
    const row = JSON.parse(record.value);
    validateSourceRow(record.table_name, row);
    grouped[record.table_name].push(row);
  }
  for (const table of Object.keys(grouped))
    if (copy.manifest.sourceRows[table] !== grouped[table].length) throw Error("TABLE_COUNT_CHANGED");
  if (Object.keys(copy.manifest.sourceRows).sort().join() !== Object.keys(grouped).sort().join())
    throw Error("TABLE_SET_CHANGED");
  checkForeignKeys(grouped);
  for (const row of grouped.cabi_note) rich(json(row.content), row.id, grouped.cabi_asset);
  for (const row of grouped.week_note) board(json(row.doc), row.week_id, grouped.note_asset, "week");
  for (const row of grouped.cabi_board) board(json(row.doc), row.id, grouped.cabi_asset, "task");
  for (const row of grouped.import_batch) {
    const undo = json(row.undo_json),
      allowed = ["relations", "deletedItems", "notes", "createdCategories", "periodStarts", "reopened"];
    if (
      !undo ||
      Array.isArray(undo) ||
      Object.keys(undo).some((k) => !allowed.includes(k)) ||
      ["deletedItems", "notes", "createdCategories", "periodStarts", "reopened"].some(
        (k) => !Array.isArray(undo[k]),
      )
    )
      throw Error("UNKNOWN_IMPORT_UNDO_FORMAT");
    for (const n of undo.notes) if (n.doc !== null) board(json(n.doc), n.weekId, grouped.note_asset, "week");
  }
  const exclusions = [],
    records = [],
    stats = {};
  const byHash = new Map(copy.blobs.map((b) => [b.id, b]));
  for (const [table, rows] of Object.entries(grouped)) {
    let excluded = 0,
      transformed = 0;
    const keys = contract.tables[table].columns
      .filter((c) => c.pk)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    const seen = new Set();
    for (const original of rows) {
      const value = structuredClone(original),
        key = hash([table, keys.map((k) => value[k])]);
      if (seen.has(key)) throw Error("DUPLICATE_RECORD_KEY");
      seen.add(key);
      if (table === "app_meta") {
        if (value.key === "schema_version") {
          excluded++;
          exclusions.push({ table, key: value.key, reason: "source-format-only" });
          continue;
        }
        if (value.key === "settings") value.value = projectSettings(value.value, exclusions);
        else if (value.key !== "created_at") throw Error("UNKNOWN_APP_META_KEY");
      }
      if (table === "cabinet_item" && value.kind === "folder") {
        value.target = null;
        value.targetState = "device-local-unbound";
        exclusions.push({ table, key: value.id, field: "target", reason: "device-filesystem-path" });
      }
      if (table === "import_batch") {
        value.file_name = folderBase(value.file_name);
        if (value.file_name !== original.file_name)
          exclusions.push({ table, key: value.id, field: "file_name", reason: "path-basename-only" });
      }
      if (table === "knowledge_card_source") {
        const locator = json(value.locator_json);
        if (Object.keys(locator).some((k) => k !== "label")) throw Error("UNKNOWN_LOCATOR_FORMAT");
      }
      if (assetTables.has(table))
        for (const field of ["dataRef", "thumbRef"]) {
          const ref = value[field];
          if (ref === null) continue;
          const blob = byHash.get(ref.blob);
          if (!blob || blob.bytes !== ref.bytes) throw Error("BLOB_REFERENCE");
          value[field] = { objectId: blob.object_id, sha256: blob.id, bytes: blob.bytes };
        }
      imageFree(value);
      if (hash(original) !== hash(value)) transformed++;
      records.push({ table, key, value });
    }
    stats[table] = {
      sourceRows: rows.length,
      mappedRows: rows.length - excluded,
      excludedRows: excluded,
      transformedRows: transformed,
    };
  }
  records.sort((a, b) => a.table.localeCompare(b.table) || a.key.localeCompare(b.key));
  const envelope = {
    profile: workspaceMapProfile,
    workspaceId,
    sourceSchema: 18,
    contractFingerprint: contract.fingerprint,
    sourceManifestHash: hash(copy.manifest),
    assets: copy.blobs
      .map((b) => ({ objectId: b.object_id, sha256: b.id, bytes: b.bytes }))
      .sort((a, b) => a.objectId.localeCompare(b.objectId)),
    records,
    tableStats: stats,
    exclusions,
    policies: {
      folderTargets: "device-local-unbound",
      sourceModel: "permanent-local-unchanged",
      imageBodies: "private-blob-only",
    },
  };
  imageFree(envelope);
  return { envelope, mappingHash: hash(envelope), productActivationAllowed: false };
}
