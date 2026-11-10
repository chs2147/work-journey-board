import type { LiveSnapshot, LiveEntry } from "../domain/liveWidget";
import { weekIdOf } from "../domain/week";
// Called exclusively through JournalRepository.cabi. Uses its guarded driver/backup gate.
import type { SqlDriver, SqlStatement } from "./driver";
import { uuidv7 } from "./ids";
import {
  emptyContent,
  emptyDoc,
  noteAssetIds,
  parseNoteDoc,
  withoutRef,
  LINK_MAX,
  type NoteDoc,
} from "../domain/note";
import {
  CABI_MAX,
  CabiConflictError,
  CabiLockedError,
  copyTitle,
  remapAssets,
  cabiAssetIds,
  cabiText,
  cabiTitle,
  cleanCabiContent,
  memoSummary,
  type BoardOwner,
  type CabiNote,
  type CabiNoteSummary,
  type TaskBoard,
  type WeeklyMemo,
} from "../domain/cabi";
import type { JournalRepository, NoteAsset, NoteAssetMeta, NoteAssetView } from "./repository";

type NoteRow = Omit<CabiNote, "content" | "deleteLocked"> & { content: string; deleteLocked: number };
type BoardRow = Omit<TaskBoard, "doc"> & { doc: string };
const NOTE_SELECT =
  "SELECT id, category_id AS categoryId,title,content,revision,created_at AS createdAt,updated_at AS updatedAt,delete_locked AS deleteLocked FROM cabi_note";
const BOARD_SELECT =
  "SELECT id,category_id AS categoryId,doc,revision,updated_at AS updatedAt FROM cabi_board";
export class CabiRepository {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private db: SqlDriver,
    private journal: JournalRepository,
    private clock: () => Date,
  ) {}
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const job = this.writes.then(f);
    this.writes = job.catch(() => undefined);
    return job;
  }
  private ts() {
    return this.clock().toISOString();
  }
  private async verifyAssetOwner(kind: "note" | "board", ownerId: string, ids: string[]) {
    if (!ids.length) return;
    const unique = [...new Set(ids)],
      rows = await this.db.select<{ id: string }>(
        `SELECT id FROM cabi_asset WHERE owner_kind=? AND owner_id=? AND id IN(${unique.map(() => "?").join(",")})`,
        [kind, ownerId, ...unique],
      );
    if (rows.length !== unique.length)
      throw new Error(
        "이미지를 이 문서에 복제한 뒤 저장해 주세요. 원본 문서의 이미지를 직접 참조할 수 없습니다.",
      );
  }
  private async exists(categoryId: string) {
    if (!(await this.db.select("SELECT id FROM category WHERE id=?", [categoryId])).length)
      throw new Error("업무를 찾을 수 없습니다.");
  }
  async listNotes(categoryId?: string, query = ""): Promise<CabiNoteSummary[]> {
    const rows = await this.db.select<Omit<CabiNoteSummary, "deleteLocked"> & { deleteLocked: number }>(
      `SELECT id,category_id AS categoryId,title,substr(plain_text,1,180) AS excerpt,revision,created_at AS createdAt,updated_at AS updatedAt,delete_locked AS deleteLocked FROM cabi_note WHERE (? IS NULL OR category_id=?) AND (instr(lower(title),lower(?))>0 OR instr(lower(plain_text),lower(?))>0) ORDER BY updated_at DESC,id`,
      [categoryId ?? null, categoryId ?? null, query, query],
    );
    return rows.map((r) => ({ ...r, deleteLocked: !!r.deleteLocked }));
  }
  async note(id: string): Promise<CabiNote> {
    const [row] = await this.db.select<NoteRow>(`${NOTE_SELECT} WHERE id=?`, [id]);
    if (!row) throw new Error("노트가 삭제되었거나 다른 공간에 있습니다.");
    return { ...row, deleteLocked: !!row.deleteLocked, content: cleanCabiContent(JSON.parse(row.content)) };
  }
  async createNote(
    categoryId: string,
    title = "제목 없는 노트",
    content = emptyContent(),
  ): Promise<CabiNote> {
    return this.serial(async () => {
      await this.exists(categoryId);
      const id = uuidv7(),
        ts = this.ts(),
        clean = cleanCabiContent(content);
      await this.verifyAssetOwner("note", id, cabiAssetIds(clean));
      if (JSON.stringify(clean).length > CABI_MAX) throw new Error("노트가 너무 큽니다.");
      await this.db.execute(
        "INSERT INTO cabi_note(id,category_id,title,content,plain_text,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        [id, categoryId, cabiTitle(title), JSON.stringify(clean), cabiText(clean), ts, ts],
      );
      return this.note(id);
    });
  }
  async saveNote(
    id: string,
    revision: number,
    title: string,
    content: CabiNote["content"],
    categoryId?: string,
  ): Promise<CabiNote> {
    return this.serial(async () => {
      const clean = cleanCabiContent(content),
        json = JSON.stringify(clean);
      if (json.length > CABI_MAX) throw new Error("노트가 너무 큽니다.");
      const current = await this.note(id);
      await this.verifyAssetOwner("note", id, cabiAssetIds(clean));
      if (current.revision !== revision) throw new CabiConflictError();
      if (categoryId) await this.exists(categoryId);
      try {
        await this.db.execute(
          "UPDATE cabi_note SET title=?,content=?,plain_text=?,category_id=?,revision=?,updated_at=? WHERE id=?",
          [
            cabiTitle(title),
            json,
            cabiText(clean),
            categoryId ?? current.categoryId,
            revision + 1,
            this.ts(),
            id,
          ],
        );
      } catch (e) {
        if (String(e).includes("CABI_CONFLICT")) throw new CabiConflictError();
        throw e;
      }
      return this.note(id);
    });
  }
  async removeNote(id: string, revision: number): Promise<void> {
    await this.serial(async () => {
      const n = await this.note(id);
      if (n.deleteLocked) throw new CabiLockedError();
      if (n.revision !== revision) throw new CabiConflictError();
      await this.db.batch([
        {
          sql: "DELETE FROM cabi_note WHERE id=? AND revision=? AND delete_locked=0",
          params: [id, revision],
        },
        { sql: "DELETE FROM cabi_asset WHERE owner_kind='note' AND owner_id=?", params: [id] },
      ]);
    });
  }
  /** 삭제 잠금 켜기/끄기(improve-v20-spec 2절) — 본문 revision과 따로(편집 중 충돌을 만들지 않음) */
  async setNoteDeleteLock(id: string, locked: boolean): Promise<CabiNote> {
    return this.serial(async () => {
      await this.note(id);
      await this.db.execute("UPDATE cabi_note SET delete_locked=? WHERE id=?", [locked ? 1 : 0, id]);
      return this.note(id);
    });
  }
  /**
   * 노트 복제(improve-v20-spec 4절): 같은 업무에 "<제목> (사본)" — 본문 그대로, 이미지는 새 id·새 소유자로 복사,
   * 연결·삭제 잠금은 옮기지 않음. 노트 1행 + 자산 n행을 한 batch로.
   */
  async duplicateNote(id: string): Promise<CabiNote> {
    return this.serial(async () => {
      const src = await this.note(id);
      const titles = new Set(
        (
          await this.db.select<{ title: string }>("SELECT title FROM cabi_note WHERE category_id=?", [
            src.categoryId,
          ])
        ).map((r) => r.title),
      );
      const title = copyTitle(src.title, titles);
      const ids = cabiAssetIds(src.content);
      const map = new Map(ids.map((a) => [a, uuidv7()] as const));
      const content = remapAssets(src.content, map);
      const json = JSON.stringify(content);
      if (json.length > CABI_MAX) throw new Error("노트가 너무 큽니다.");
      const newId = uuidv7(),
        ts = this.ts();
      const stmts: SqlStatement[] = [
        {
          sql: "INSERT INTO cabi_note(id,category_id,title,content,plain_text,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
          params: [newId, src.categoryId, title, json, cabiText(content), ts, ts],
        },
      ];
      for (const [from, to] of map)
        stmts.push({
          sql: "INSERT INTO cabi_asset(id,owner_kind,owner_id,mime,data,width,height,bytes,thumb,thumb_mime,created_at) SELECT ?,'note',?,mime,data,width,height,bytes,thumb,thumb_mime,? FROM cabi_asset WHERE id=? AND owner_kind='note' AND owner_id=?",
          params: [to, newId, ts, from, id],
        });
      await this.db.batch(stmts);
      return this.note(newId);
    });
  }
  async referenceCount(kind: "note" | "folder" | "link", id: string): Promise<number> {
    const rows = await this.db.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM (SELECT doc FROM cabi_board UNION ALL SELECT doc FROM week_note) n,json_each(n.doc,'$.boxes') b WHERE json_extract(b.value,'$.resource.kind')=? AND json_extract(b.value,'$.resource.id')=?",
      [kind, id],
    );
    return rows[0]?.n ?? 0;
  }
  async searchBoards(query: string): Promise<{ id: string; categoryId: string; title: string }[]> {
    return this.db.select(
      "SELECT b.id,b.category_id AS categoryId,c.name AS title FROM cabi_board b JOIN category c ON c.id=b.category_id WHERE instr(lower(c.name),lower(?))>0 OR EXISTS(SELECT 1 FROM json_tree(b.doc) t WHERE t.key='text' AND instr(lower(CAST(t.value AS TEXT)),lower(?))>0) ORDER BY b.updated_at DESC LIMIT 100",
      [query, query],
    );
  }
  async listBoards(): Promise<Omit<TaskBoard, "doc">[]> {
    return this.db.select(
      "SELECT id,category_id AS categoryId,revision,updated_at AS updatedAt FROM cabi_board ORDER BY updated_at DESC",
    );
  }
  async board(categoryId: string, create = false): Promise<TaskBoard | null> {
    if (create)
      await this.serial(async () => {
        await this.exists(categoryId);
        await this.db.execute(
          "INSERT OR IGNORE INTO cabi_board(id,category_id,doc,updated_at) VALUES(?,?,?,?)",
          [uuidv7(), categoryId, JSON.stringify(emptyDoc()), this.ts()],
        );
      });
    const [row] = await this.db.select<BoardRow>(`${BOARD_SELECT} WHERE category_id=?`, [categoryId]);
    if (!row) return null;
    const doc = parseNoteDoc(row.doc),
      refs = await this.db.select<{ boxId: string; entryId: string }>(
        "SELECT box_id AS boxId,entry_id AS entryId FROM cabi_entry_link WHERE board_id=?",
        [row.id],
      );
    return {
      ...row,
      doc: {
        ...doc,
        boxes: doc.boxes.map((b) => {
          const links = refs.filter((r) => r.boxId === b.id).map((r) => ({ item: r.entryId }));
          return links.length ? { ...b, refs: links } : withoutRef(b);
        }),
      },
    };
  }
  async saveBoard(
    categoryId: string,
    revision: number,
    doc: NoteDoc,
    baseline?: NoteDoc,
  ): Promise<TaskBoard> {
    return this.serial(async () => {
      const board = await this.board(categoryId);
      if (!board) throw new Error("업무 보드를 찾을 수 없습니다.");
      if (board.revision !== revision) throw new CabiConflictError();
      const clean = parseNoteDoc(JSON.stringify(doc)),
        stored = { ...clean, boxes: clean.boxes.map((b) => withoutRef(b)) },
        json = JSON.stringify(stored);
      await this.verifyAssetOwner("board", board.id, noteAssetIds(clean));
      if (json.length > CABI_MAX) throw new Error("보드가 너무 큽니다.");
      const statements: SqlStatement[] = [
        {
          sql: "UPDATE cabi_board SET doc=?,revision=?,updated_at=?,format_version=2 WHERE id=?",
          params: [json, revision + 1, this.ts(), board.id],
        },
        {
          sql: "DELETE FROM cabi_entry_link WHERE board_id=? AND box_id NOT IN(SELECT json_extract(value,'$.id') FROM json_each(?,'$.boxes'))",
          params: [board.id, json],
        },
      ];
      for (const box of clean.boxes) {
        const prev = new Set(
            (baseline ?? board.doc).boxes.find((b) => b.id === box.id)?.refs?.map((r) => r.item) ?? [],
          ),
          next = new Set(box.refs?.map((r) => r.item) ?? []);
        if (next.size > LINK_MAX) throw new Error("메모 연결은 객체당 20개까지 가능합니다.");
        for (const id of prev)
          if (!next.has(id))
            statements.push({
              sql: "DELETE FROM cabi_entry_link WHERE board_id=? AND box_id=? AND entry_id=?",
              params: [board.id, box.id, id],
            });
        for (const id of next)
          if (!prev.has(id))
            statements.push({
              sql: "INSERT OR IGNORE INTO cabi_entry_link(board_id,box_id,entry_id) SELECT ?,?,id FROM entry_item WHERE id=?",
              params: [board.id, box.id, id],
            });
      }
      try {
        await this.db.batch(statements);
      } catch (e) {
        if (String(e).includes("CABI_CONFLICT")) throw new CabiConflictError();
        throw e;
      }
      return (await this.board(categoryId))!;
    });
  }
  async widgetSnapshot(
    categoryId: string,
    today: string,
    since = "0000-01-01",
    offset = 0,
    ids: string[] = [],
    query = "",
  ): Promise<LiveSnapshot> {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(today) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(since) ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw new Error("위젯 조회 범위가 올바르지 않습니다.");
    const safe = [...new Set(ids.filter((id) => typeof id === "string" && id.length <= 64))].slice(0, 200);
    // All source values share one SQLite read snapshot, including pagination counts.
    const object = "json_object('id',id,'date',date,'text',text,'dueDate',dueDate,'doneAt',doneAt)";
    const [row] = await this.db.select<{
      title: string;
      start: string | null;
      recent: string | null;
      recordCount: number;
      importantCount: number;
      records: string;
      important: string;
      selected: string;
      days: string;
    }>(
      `
      WITH args(categoryId,today,since,offset,ids,query) AS (VALUES(?,?,?,?,?,?)),
      entries AS (SELECT e.id,e.date,e.text,e.seq,e.due_date AS dueDate,e.flag_done_at AS doneAt,e.flagged FROM entry_item e,args WHERE e.category_id=args.categoryId),
      filtered AS (SELECT e.* FROM entries e,args WHERE date BETWEEN since AND today AND instr(lower(text),lower(query))>0),
      records AS (SELECT * FROM filtered ORDER BY date DESC,seq DESC,id DESC LIMIT 40 OFFSET (SELECT offset FROM args)),
      pending AS (SELECT * FROM entries WHERE flagged=1 AND doneAt IS NULL),
      important AS (SELECT * FROM pending ORDER BY dueDate IS NULL,dueDate,date,seq,id LIMIT 20 OFFSET (SELECT offset FROM args)),
      selected AS (SELECT * FROM entries WHERE id IN(SELECT value FROM json_each((SELECT ids FROM args))) ORDER BY date,seq,id),
      days AS (SELECT date,COUNT(*) AS n,(SELECT text FROM filtered e2 WHERE e2.date=e.date ORDER BY seq DESC,id DESC LIMIT 1) AS text,(SELECT id FROM filtered e2 WHERE e2.date=e.date ORDER BY seq DESC,id DESC LIMIT 1) AS entryId FROM filtered e GROUP BY date ORDER BY date)
      SELECT c.name AS title,(SELECT MIN(start_date) FROM category_period WHERE category_id=c.id) AS start,
      (SELECT MAX(date) FROM entries WHERE date<=(SELECT today FROM args)) AS recent,
      (SELECT COUNT(*) FROM filtered) AS recordCount,(SELECT COUNT(*) FROM pending) AS importantCount,
      (SELECT json_group_array(${object}) FROM records) AS records,
      (SELECT json_group_array(${object}) FROM important) AS important,
      (SELECT json_group_array(${object}) FROM selected) AS selected,
      (SELECT json_group_array(json_object('date',date,'n',n,'text',text,'entryId',entryId)) FROM days) AS days
      FROM category c,args WHERE c.id=args.categoryId`,
      [categoryId, today, since, offset, JSON.stringify(safe), query.slice(0, 500)],
    );
    if (!row) throw new Error("위젯의 업무가 삭제되었습니다.");
    const weeks: LiveSnapshot["weeks"] = [];
    for (const d of JSON.parse(row.days) as { date: string; n: number; text: string; entryId: string }[]) {
      const weekId = weekIdOf(d.date),
        old = weeks.find((w) => w.weekId === weekId);
      if (old) {
        old.count += d.n;
        old.date = d.date;
        old.text = d.text;
        old.entryId = d.entryId;
      } else weeks.push({ weekId, count: d.n, date: d.date, text: d.text, entryId: d.entryId });
    }
    return {
      categoryId,
      title: row.title,
      today,
      start: row.start,
      recent: row.recent,
      recordCount: row.recordCount,
      importantCount: row.importantCount,
      records: JSON.parse(row.records) as LiveEntry[],
      important: JSON.parse(row.important) as LiveEntry[],
      selected: JSON.parse(row.selected) as LiveEntry[],
      weeks,
    };
  }
  async weeklyMemos(categoryId: string, query = "", offset = 0, limit = 60): Promise<WeeklyMemo[]> {
    // Read relationships first, then each source document once. Never duplicate whole JSON per entry link.
    const rows = await this.db.select<{ weekId: string; boxId: string; entryId: string; updatedAt: string }>(
      "SELECT l.note_week_id AS weekId,l.box_id AS boxId,l.entry_id AS entryId,n.updated_at AS updatedAt FROM note_entry_link l JOIN entry_item e ON e.id=l.entry_id JOIN week_note n ON n.week_id=l.note_week_id WHERE e.category_id=? ORDER BY l.note_week_id DESC,l.box_id,l.entry_id",
      [categoryId],
    );
    const groups = new Map<
      string,
      { weekId: string; boxId: string; entryIds: string[]; updatedAt: string }
    >();
    for (const row of rows) {
      const key = row.weekId + "/" + row.boxId,
        old = groups.get(key);
      if (old) old.entryIds.push(row.entryId);
      else groups.set(key, { ...row, entryIds: [row.entryId] });
    }
    const out: WeeklyMemo[] = [];
    let currentWeek = "",
      doc = emptyDoc(),
      matched = 0;
    const safeLimit = Math.min(200, Math.max(1, limit)),
      needle = query.toLocaleLowerCase();
    for (const group of groups.values()) {
      if (currentWeek !== group.weekId) {
        const [row] = await this.db.select<{ doc: string }>("SELECT doc FROM week_note WHERE week_id=?", [
          group.weekId,
        ]);
        doc = parseNoteDoc(row?.doc);
        currentWeek = group.weekId;
      }
      const box = doc.boxes.find((b) => b.id === group.boxId);
      if (!box) continue;
      const title = memoSummary(box) || "이미지 메모";
      if (!(title + " " + group.weekId).toLocaleLowerCase().includes(needle)) continue;
      if (matched++ < Math.max(0, offset)) continue;
      out.push({ ...group, title, text: title });
      if (out.length >= safeLimit) break;
    }
    return out;
  }

  async assets(kind: "note" | "board", ownerId: string): Promise<NoteAsset[]> {
    return this.db.select(
      "SELECT id,mime,data,width,height,bytes FROM cabi_asset WHERE owner_kind=? AND owner_id=?",
      [kind, ownerId],
    );
  }
  async assetMeta(kind: "note" | "board", ownerId: string): Promise<NoteAssetMeta[]> {
    return this.db.select(
      "SELECT id,mime,width,height,bytes FROM cabi_asset WHERE owner_kind=? AND owner_id=?",
      [kind, ownerId],
    );
  }
  async asset(id: string): Promise<NoteAsset | null> {
    const [a] = await this.db.select<NoteAsset>(
      "SELECT id,mime,data,width,height,bytes FROM cabi_asset WHERE id=?",
      [id],
    );
    return a ?? null;
  }
  async assetView(id: string): Promise<NoteAssetView | null> {
    const [a] = await this.db.select<NoteAssetView>(
      "SELECT COALESCE(thumb_mime,mime) AS mime,COALESCE(thumb,data) AS data,thumb IS NOT NULL AS thumb FROM cabi_asset WHERE id=?",
      [id],
    );
    return a ? { ...a, thumb: !!a.thumb } : null;
  }
  async addAsset(
    kind: "note" | "board",
    ownerId: string,
    a: Omit<NoteAsset, "id">,
    thumb?: { mime: string; data: string } | null,
  ): Promise<string> {
    const id = uuidv7();
    if (
      !["image/webp", "image/png", "image/jpeg", "image/gif"].includes(a.mime) ||
      !a.width ||
      !a.height ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(a.data) ||
      a.data.length > 14_000_000
    )
      throw new Error("이미지가 올바르지 않거나 너무 큽니다.");
    const table = kind === "note" ? "cabi_note" : "cabi_board";
    if (!(await this.db.select(`SELECT id FROM ${table} WHERE id=?`, [ownerId])).length)
      throw new Error("이미지를 저장할 문서가 없습니다.");
    await this.db.execute(
      "INSERT INTO cabi_asset(id,owner_kind,owner_id,mime,data,width,height,bytes,thumb,thumb_mime,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        kind,
        ownerId,
        a.mime,
        a.data,
        a.width,
        a.height,
        Math.floor((a.data.length * 3) / 4),
        thumb?.data ?? null,
        thumb?.mime ?? null,
        this.ts(),
      ],
    );
    return id;
  }
  async setThumb(id: string, t: { mime: string; data: string }): Promise<void> {
    if (!["image/webp", "image/png"].includes(t.mime) || t.data.length > 14_000_000) return;
    await this.db.execute("UPDATE cabi_asset SET thumb=?,thumb_mime=? WHERE id=? AND thumb IS NULL", [
      t.data,
      t.mime,
      id,
    ]);
  }
  async pruneAssets(kind: "note" | "board", ownerId: string, keep: string[]): Promise<number> {
    // Owner isolation: copies always have their own asset rows. No other document is affected.
    const { changes } = await this.db.execute(
      `DELETE FROM cabi_asset WHERE owner_kind=? AND owner_id=?${keep.length ? ` AND id NOT IN(${keep.map(() => "?").join(",")})` : ""}`,
      [kind, ownerId, ...keep],
    );
    return changes;
  }
  async copyAssets(owner: BoardOwner, assets: NoteAsset[]): Promise<Record<string, string>> {
    const board = owner.kind === "task" ? await this.board(owner.categoryId) : null;
    if (owner.kind === "task" && !board) throw new Error("받을 보드가 없습니다.");
    if (owner.kind === "week" && !/^\d{4}-W\d{2}$/.test(owner.weekId))
      throw new Error("받을 주차가 올바르지 않습니다.");
    const mapping: Record<string, string> = {},
      stmts: SqlStatement[] = [];
    for (const a of assets) {
      const id = uuidv7();
      mapping[a.id] = id;
      stmts.push(
        board
          ? {
              sql: "INSERT INTO cabi_asset(id,owner_kind,owner_id,mime,data,width,height,bytes,created_at) VALUES(?,'board',?,?,?,?,?,?,?)",
              params: [id, board.id, a.mime, a.data, a.width, a.height, a.bytes, this.ts()],
            }
          : {
              sql: "INSERT INTO note_asset(id,week_id,mime,data,width,height,bytes,created_at) VALUES(?,?,?,?,?,?,?,?)",
              params: [
                id,
                (owner as { weekId: string }).weekId,
                a.mime,
                a.data,
                a.width,
                a.height,
                a.bytes,
                this.ts(),
              ],
            },
      );
    }
    if (stmts.length) await this.db.batch(stmts);
    return mapping;
  }
  /** Copy image rows inside SQLite. Large selections never materialise base64 in window/RPC payloads. */
  async copyOwnedAssets(
    source: BoardOwner,
    target: BoardOwner,
    ids: string[],
  ): Promise<Record<string, string>> {
    if (!ids.length) return {};
    const from = source.kind === "task" ? await this.board(source.categoryId) : null,
      to = target.kind === "task" ? await this.board(target.categoryId) : null;
    if ((source.kind === "task" && !from) || (target.kind === "task" && !to))
      throw new Error("원본 또는 목적 보드를 찾을 수 없습니다.");
    const sourceTable = source.kind === "week" ? "note_asset" : "cabi_asset",
      targetTable = target.kind === "week" ? "note_asset" : "cabi_asset";
    const sourceOwner = source.kind === "week" ? source.weekId : from!.id,
      targetOwner = target.kind === "week" ? target.weekId : to!.id;
    const where = source.kind === "week" ? "week_id=?" : "owner_kind='board' AND owner_id=?",
      columns = target.kind === "week" ? "id,week_id" : "id,owner_kind,owner_id",
      values = target.kind === "week" ? "?,?" : "?,'board',?";
    const mapping: Record<string, string> = {},
      statements: SqlStatement[] = [];
    for (const old of [...new Set(ids)]) {
      const id = uuidv7();
      mapping[old] = id;
      statements.push({
        sql: `WITH original AS (SELECT mime,data,width,height,bytes,thumb,thumb_mime FROM ${sourceTable} WHERE id=? AND ${where}) INSERT INTO ${targetTable}(${columns},mime,data,width,height,bytes,thumb,thumb_mime,created_at) VALUES(${values},(SELECT mime FROM original),(SELECT data FROM original),(SELECT width FROM original),(SELECT height FROM original),(SELECT bytes FROM original),(SELECT thumb FROM original),(SELECT thumb_mime FROM original),?)`,
        params: [old, sourceOwner, id, targetOwner, this.ts()],
      });
    }
    // Missing sources become NULL in required columns and roll back the entire copy batch.
    await this.db.batch(statements);
    return mapping;
  }
  async source(owner: BoardOwner): Promise<NoteDoc> {
    if (owner.kind === "week") return (await this.journal.getWeekNote(owner.weekId)).doc;
    const board = await this.board(owner.categoryId);
    if (!board) throw new Error("원본 보드가 없습니다.");
    return board.doc;
  }
  async sourceAssets(owner: BoardOwner, doc: NoteDoc): Promise<NoteAsset[]> {
    const out: NoteAsset[] = [];
    for (const id of noteAssetIds(doc)) {
      const asset = owner.kind === "week" ? await this.journal.getNoteAsset(id) : await this.asset(id);
      if (!asset) throw new Error("원본 이미지를 찾을 수 없습니다. 다시 선택해 주세요.");
      out.push(asset);
    }
    return out;
  }
  async removeBoard(categoryId: string, revision: number) {
    return this.serial(async () => {
      const board = await this.board(categoryId);
      if (!board || board.revision !== revision) throw new CabiConflictError();
      await this.db.batch([
        { sql: "DELETE FROM cabi_board WHERE id=?", params: [board.id] },
        { sql: "DELETE FROM cabi_asset WHERE owner_kind='board' AND owner_id=?", params: [board.id] },
      ]);
    });
  }
}
