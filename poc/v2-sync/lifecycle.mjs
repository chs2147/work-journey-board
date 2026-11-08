import { transaction, record, state, hash } from "./model.mjs";
import { rowId } from "./stage-import.mjs";
import { initCells, cellRows, validateCellRows, cellKey, cellVersion, contentVersion } from "./cells.mjs";
export function initLifecycle(db) {
  initCells(db);
  db.exec(`CREATE TABLE IF NOT EXISTS tombstones(scope TEXT,g INTEGER,id TEXT,rev INTEGER,seq INTEGER,payload TEXT,PRIMARY KEY(scope,g,id));
CREATE TABLE IF NOT EXISTS retired_ids(scope TEXT,g INTEGER,id TEXT,PRIMARY KEY(scope,g,id));
CREATE TABLE IF NOT EXISTS compound_documents(scope TEXT,id TEXT,PRIMARY KEY(scope,id));
CREATE TABLE IF NOT EXISTS sync_retention(scope TEXT PRIMARY KEY,floor INTEGER);`);
}
export function checkCursor(db, s, cursor) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_retention'").get();
  const floor = exists
    ? (db.prepare("SELECT floor FROM sync_retention WHERE scope=?").get(s)?.floor ?? 0)
    : 0;
  if (floor > 0 && (!Number.isSafeInteger(cursor) || cursor < floor)) throw Error("RESYNC_REQUIRED");
}
export function allRecords(db, s) {
  return db
    .prepare("SELECT id,rev,body FROM records WHERE scope=? ORDER BY id")
    .all(s)
    .map((r) => ({ ...r, body: JSON.parse(r.body) }));
}
export function documentLinks(db, s, id) {
  const doc = record(db, s, id);
  if (!doc) throw Error("DOCUMENT_REQUIRED");
  const row = doc.body.row;
  return allRecords(db, s).filter(
    (r) =>
      (doc.body.table === "week_note" &&
        r.body.table === "note_entry_link" &&
        r.body.row.note_week_id === row.week_id) ||
      (doc.body.table === "cabi_board" &&
        r.body.table === "cabi_entry_link" &&
        r.body.row.board_id === row.id),
  );
}
export function validateDocument(db, s, body, links) {
  if (!["week_note", "cabi_board", "cabi_note"].includes(body.table)) throw Error("DOCUMENT_KIND");
  if (!Array.isArray(links)) throw Error("LINK_FORMAT");
  if (body.table === "cabi_note") {
    const doc = JSON.parse(body.row.content);
    if (doc.type !== "doc" || !Array.isArray(doc.content) || links.length) throw Error("NOTE_FORMAT");
    return;
  }
  const doc = JSON.parse(body.row.doc);
  if (doc.v !== 1 || !Array.isArray(doc.boxes)) throw Error("DOCUMENT_FORMAT");
  const boxes = new Set(doc.boxes.map((b) => b.id));
  if (boxes.size !== doc.boxes.length) throw Error("DUPLICATE_BOX");
  for (const edge of doc.edges ?? [])
    if (!boxes.has(edge.from) || !boxes.has(edge.to)) throw Error("EDGE_REFERENCE");
  for (const b of doc.boxes)
    if (b.asset) {
      const table = body.table === "week_note" ? "note_asset" : "cabi_asset",
        asset = record(db, s, rowId(table, [b.asset]));
      if (
        !asset ||
        (table === "note_asset"
          ? asset.body.row.week_id !== body.row.week_id
          : asset.body.row.owner_kind !== "board" || asset.body.row.owner_id !== body.row.id)
      )
        throw Error("ASSET_OWNER");
    }
  const unique = new Set(),
    count = new Map();
  for (const l of links) {
    if (!boxes.has(l.boxId) || !record(db, s, rowId("entry_item", [l.entryId]))) throw Error("LINK_TARGET");
    const k = JSON.stringify([l.boxId, l.entryId]);
    if (unique.has(k)) throw Error("DUPLICATE_LINK");
    unique.add(k);
    count.set(l.boxId, (count.get(l.boxId) ?? 0) + 1);
    if (count.get(l.boxId) > 20) throw Error("LINK_LIMIT");
  }
}
export function validateGraph(db, s) {
  const list = allRecords(db, s),
    by = new Map(list.map((r) => [r.id, r])),
    links = new Map(),
    groups = new Map();
  for (const r of list) {
    if (r.body.table === "entry_item") {
      const key = cellKey(r.body.row.date, r.body.row.category_id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    if (["note_entry_link", "cabi_entry_link"].includes(r.body.table)) {
      const doc =
        r.body.table === "note_entry_link"
          ? rowId("week_note", [r.body.row.note_week_id])
          : rowId("cabi_board", [r.body.row.board_id]);
      if (!by.has(doc)) throw Error("ORPHAN_DOCUMENT");
      if (!links.has(doc)) links.set(doc, []);
      links.get(doc).push({ boxId: r.body.row.box_id, entryId: r.body.row.entry_id });
    }
    if (
      ["note_entry_link", "cabi_entry_link", "cabinet_link"].includes(r.body.table) &&
      r.body.row.entry_id &&
      !by.has(rowId("entry_item", [r.body.row.entry_id]))
    )
      throw Error("ORPHAN_LINK");
  }
  for (const r of list)
    if (["week_note", "cabi_board", "cabi_note"].includes(r.body.table))
      validateDocument(db, s, r.body, links.get(r.id) ?? []);
  for (const group of groups.values())
    validateCellRows(group.sort((a, b) => a.body.row.seq - b.body.row.seq));
}
export function applyLifecycle(db, account, cmd, fault = () => {}) {
  initLifecycle(db);
  if (!cmd.scope.startsWith(account + "/")) throw Error("ACCESS_REVOKED");
  const result = transaction(db, () => {
    const st = state(db, cmd.scope);
    if (st.generation !== cmd.generation) throw Error("GENERATION_CHANGED");
    const old = db.prepare("SELECT * FROM ops WHERE scope=? AND id=?").get(cmd.scope, cmd.opId);
    if (old) {
      if (old.request !== hash(cmd)) throw Error("IDEMPOTENCY_KEY_REUSED");
      return JSON.parse(old.result);
    }
    checkCursor(db, cmd.scope, cmd.baseCursor);
    const rows = [],
      deletes = [],
      cells = [],
      contents = [],
      seq = st.cursor + 1;
    function put(id, body) {
      const before = record(db, cmd.scope, id),
        dead = db
          .prepare("SELECT rev FROM tombstones WHERE scope=? AND g=? AND id=?")
          .get(cmd.scope, st.generation, id);
      const r = { id, rev: (before?.rev ?? dead?.rev ?? 0) + 1, body };
      db.prepare(
        "INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET rev=excluded.rev,body=excluded.body",
      ).run(cmd.scope, id, r.rev, JSON.stringify(body));
      db.prepare("DELETE FROM tombstones WHERE scope=? AND g=? AND id=?").run(cmd.scope, st.generation, id);
      rows.push(r);
      return r;
    }
    function remove(r) {
      const d = { id: r.id, rev: r.rev + 1 };
      db.prepare("DELETE FROM records WHERE scope=? AND id=?").run(cmd.scope, r.id);
      db.prepare(
        "INSERT INTO tombstones VALUES(?,?,?,?,?,?) ON CONFLICT(scope,g,id) DO UPDATE SET rev=excluded.rev,seq=excluded.seq,payload=excluded.payload",
      ).run(cmd.scope, st.generation, r.id, d.rev, seq, JSON.stringify(r));
      db.prepare("INSERT OR IGNORE INTO retired_ids VALUES(?,?,?)").run(cmd.scope, st.generation, r.id);
      deletes.push(d);
    }
    if (cmd.kind === "delete-subtree" || cmd.kind === "insert-child") {
      const parent = record(db, cmd.scope, cmd.id);
      if (!parent || parent.body.table !== "entry_item") throw Error("ENTRY_REQUIRED");
      const key = cellKey(parent.body.row.date, parent.body.row.category_id);
      if (
        key !== cellKey(cmd.cell.date, cmd.cell.categoryId) ||
        cellVersion(db, cmd.scope, key) !== cmd.cell.version
      )
        throw Error("CELL_CONFLICT");
      const list = cellRows(db, cmd.scope, key),
        start = list.findIndex((r) => r.id === cmd.id);
      if (start < 0 || list[start].body.row.depth !== 0) throw Error("ROOT_REQUIRED");
      let end = start + 1;
      while (end < list.length && list[end].body.row.depth === 1) end++;
      let next;
      if (cmd.kind === "delete-subtree") {
        const group = list.slice(start, end);
        if (hash(Object.keys(cmd.expectedContent).sort()) !== hash(group.map((r) => r.id).sort()))
          throw Error("ROWSET_CONFLICT");
        for (const r of group)
          if (contentVersion(db, cmd.scope, r.id) !== cmd.expectedContent[r.id])
            throw Error("CONTENT_CONFLICT");
        const gone = new Set(group.map((r) => r.body.row.id));
        for (const r of allRecords(db, cmd.scope))
          if (
            ["note_entry_link", "cabi_entry_link", "cabinet_link"].includes(r.body.table) &&
            gone.has(r.body.row.entry_id)
          )
            remove(r);
        for (const r of group) {
          contents.push({ id: r.id, rev: contentVersion(db, cmd.scope, r.id) + 1, deleted: true });
          remove(r);
        }
        fault("after-delete");
        next = [...list.slice(0, start), ...list.slice(end)];
      } else {
        const id = rowId("entry_item", [cmd.newId]);
        if (
          typeof cmd.newId !== "string" ||
          !cmd.newId ||
          record(db, cmd.scope, id) ||
          db
            .prepare("SELECT 1 FROM retired_ids WHERE scope=? AND g=? AND id=?")
            .get(cmd.scope, st.generation, id)
        )
          throw Error("ID_RETIRED_OR_USED");
        if (typeof cmd.text !== "string" || cmd.text.length < 1 || cmd.text.length > 2000)
          throw Error("PATCH_VALUE");
        const now = new Date().toISOString();
        const row = {
          ...parent.body.row,
          id: cmd.newId,
          text: cmd.text,
          depth: 1,
          flagged: 0,
          flag_done_at: null,
          recurrence_id: null,
          import_id: null,
          due_date: null,
          start_time: null,
          created_at: now,
          updated_at: now,
        };
        next = [...list.slice(0, end), { id, body: { table: "entry_item", row } }, ...list.slice(end)];
        contents.push({ id, rev: 1 });
      }
      for (const [i, r] of next.entries()) {
        const body = { ...r.body, row: { ...r.body.row, seq: i + 1 } };
        if (!record(db, cmd.scope, r.id) || hash(body) !== hash(r.body)) put(r.id, body);
      }
      const rev = cmd.cell.version + 1;
      db.prepare(
        "INSERT INTO cell_versions VALUES(?,?,?,?) ON CONFLICT(scope,g,id) DO UPDATE SET rev=excluded.rev",
      ).run(cmd.scope, st.generation, key, rev);
      cells.push({ id: key, rev });
    } else if (cmd.kind === "save-document") {
      const before = record(db, cmd.scope, cmd.id);
      if (!before || before.rev !== cmd.baseRevision) throw Error("DOCUMENT_CONFLICT");
      if (
        cmd.body.table !== before.body.table ||
        hash(Object.keys(cmd.body.row).sort()) !== hash(Object.keys(before.body.row).sort())
      )
        throw Error("DOCUMENT_FORMAT");
      const fields =
        before.body.table === "cabi_note"
          ? ["title", "content", "plain_text", "format_version"]
          : ["doc", "format_version"];
      for (const k of Object.keys(before.body.row))
        if (!fields.includes(k) && hash(before.body.row[k]) !== hash(cmd.body.row[k]))
          throw Error("DOCUMENT_OWNER");
      validateDocument(db, cmd.scope, cmd.body, cmd.links);
      const body = JSON.parse(JSON.stringify(cmd.body));
      if (body.table !== "cabi_note") {
        const doc = JSON.parse(body.row.doc);
        for (const box of doc.boxes) {
          delete box.refs;
          delete box.ref;
        }
        body.row.doc = JSON.stringify(doc);
      }
      if ("revision" in body.row) body.row.revision = before.body.row.revision + 1;
      const previous = documentLinks(db, cmd.scope, cmd.id),
        wanted = new Set();
      for (const l of cmd.links) {
        const weekly = body.table === "week_note",
          table = weekly ? "note_entry_link" : "cabi_entry_link",
          raw = weekly
            ? {
                note_week_id: body.row.week_id,
                box_id: l.boxId,
                entry_id: l.entryId,
                created_at: new Date().toISOString(),
              }
            : { board_id: body.row.id, box_id: l.boxId, entry_id: l.entryId };
        const id = rowId(table, [weekly ? body.row.week_id : body.row.id, l.boxId, l.entryId]);
        wanted.add(id);
        if (!record(db, cmd.scope, id)) put(id, { table, row: raw });
      }
      for (const r of previous) if (!wanted.has(r.id)) remove(r);
      fault("after-links");
      put(cmd.id, body);
      fault("after-document");
      db.prepare("INSERT OR IGNORE INTO compound_documents VALUES(?,?)").run(cmd.scope, cmd.id);
    } else throw Error("COMMAND_KIND");
    for (const c of contents)
      db.prepare(
        "INSERT INTO content_versions VALUES(?,?,?,?) ON CONFLICT(scope,g,id) DO UPDATE SET rev=excluded.rev",
      ).run(cmd.scope, st.generation, c.id, c.rev);
    const event = {
      kind: "entry-batch",
      scope: cmd.scope,
      generation: st.generation,
      opId: cmd.opId,
      seq,
      rows,
      deletes,
      cells,
      contents,
    };
    db.prepare("INSERT INTO changes VALUES(?,?,?)").run(cmd.scope, seq, JSON.stringify(event));
    db.prepare("UPDATE state SET cursor=? WHERE scope=?").run(seq, cmd.scope);
    db.prepare("INSERT INTO ops VALUES(?,?,?,?)").run(cmd.scope, cmd.opId, hash(cmd), JSON.stringify(event));
    fault("before-commit");
    return event;
  });
  fault("after-commit");
  return result;
}
