// E-3·E-4 온라인 공간 동기화 엔진(Connected Preview, docs/v2-design/91) — 이 기기 일지 ↔ 서버(019).
// 원칙(88문서 0절): 고치면 이 기기에 먼저 저장(대기열은 트리거가 같은 트랜잭션에), 서버가 판을 확인하고 확정.
// - 보내기: 대기열 (표, 기본 키) → 지금 행 → 행 사상(mapRow, 이관과 같은 규칙) → 기준과 다를 때만 push(기대 판).
//   새 그림은 먼저 비공개 저장소로(신고 → 예약 → 올리기) — 서버 DB에는 참조만.
// - 받기: 순번 이후 변경 → (이 기기에 안 보낸 변경이 없으면) 그대로 적용 / (있으면) 칸 단위 합치기 → 안 되면 충돌로 보존.
//   적용 중에는 대기열 트리거(applying=1)와 앱 트리거(상태 이력 등)를 끄고, 외래 키는 묶음 끝에 확인.
// - 충돌: 텍스트를 마지막 저장으로 덮어쓰지 않는다. 고르기 전까지 그 기록은 보내지 않고 다른 기록은 계속 동기화.
import { base64ToBytes, bytesToBase64, canonical, hash, sha256Hex } from "../../poc/v2-sync/hash-core.mjs";
import {
  createWorkspaceMapper,
  type MappedAsset,
  type MappedRecord,
} from "../../poc/v2-migration/workspace-map-core.mjs";
import { createWorkspaceRestorer, UNBOUND_FOLDER } from "../../poc/v2-migration/workspace-restore-core.mjs";
import type { SqlDriver, SqlParam, SqlStatement } from "../data/driver";
import { SECTION_ICONS } from "../shared/sectionIcons";
import { SYNC_PREFIX } from "./spaceJournal";

/** 통신(실앱 = Rust space_sync.rs, 브라우저 모드 = 가짜 서버) */
export interface SyncTransport {
  call(action: "push" | "pull", params: Record<string, unknown>): Promise<Record<string, unknown>>;
  uploadAsset(workspaceId: string, objectId: string, sha256: string, bytes: Uint8Array): Promise<void>;
  fetchAsset(workspaceId: string, objectId: string, sha256: string, bytes: number): Promise<Uint8Array>;
}
/** 지금 열린 이 기기 일지(앱 저장소의 연결·차례 줄) — 없으면 동기화하지 않는다 */
export interface SyncJournal {
  driver: SqlDriver;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
}
export interface SyncStatus {
  phase: "idle" | "syncing" | "offline" | "error";
  pending: number;
  conflicts: number;
  lastSyncedAt: number | null;
  error: string | null;
}
export interface ConflictItem {
  table: string;
  key: string;
  local: Record<string, unknown> | null;
  server: Record<string, unknown> | null;
  serverRev: number | null;
  at: number;
}
export type Resolution = "mine" | "server" | "both";

const PUSH_MAX_CHANGES = 400;
/** 한 번에 읽는 대기열 수 — 넘으면 같은 동기화 안에서 이어서 보낸다(오래 오프라인 뒤 많이 고친 경우) */
export const OUTBOX_PAGE = 2000;
const PUSH_MAX_BYTES = 800_000;
const PULL_LIMIT = 500;
/** 같은 칸을 양쪽에서 고치면 칸 합치기 대신 문서째 보존하는 표(주간 메모·메모보드·업무노트) */
export const DOCUMENT_TABLES = new Set(["week_note", "cabi_board", "cabi_note"]);
/** "둘 다 보존"을 고를 수 있는 표 */
export const BOTH_TABLES = new Set(["entry_item", "cabi_note", "week_note", "cabi_board"]);

const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
const OFFLINE = /NETWORK|UNAVAILABLE|HTTP_5|SIGNED_OUT|TIMEOUT/;
type Row = Record<string, unknown>;
type Change = { table: string; key: string; baseRev: number | null; value: Row | null };
type Entry = { tbl: string; pk: string; at: number; key: string };
interface Base {
  rev: number;
  hash: string;
  value: string | null;
}

const mapper = createWorkspaceMapper({ hash, sectionIconIds: new Set(SECTION_ICONS.map((i) => i.id)) });
const restorer = createWorkspaceRestorer({ hash, bytesToBase64 });

/** 고친 시각 칸 — 양쪽이 다른 칸을 고쳐도 늘 함께 바뀌므로 겹침으로 보지 않고 늦은 시각을 쓴다 */
const TIME_FIELDS = new Set(["updated_at"]);
/** 칸 단위 세 갈래 합치기. 겹치는 칸(고친 시각 칸 말고)이 있으면 null */
export function merge3(base: Row | null, mine: Row, theirs: Row): Row | null {
  if (!base) return null;
  const out: Row = {};
  const time: string[] = [];
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const b = canonical(base[k] ?? null),
      m = canonical(mine[k] ?? null),
      t = canonical(theirs[k] ?? null);
    if (m === t || t === b) out[k] = mine[k];
    else if (m === b) out[k] = theirs[k];
    else if (TIME_FIELDS.has(k)) time.push(k);
    else return null;
  }
  // 실제 내용은 한쪽만 고친 경우에만 합친다(고친 시각만 다른 것은 늦은 쪽)
  for (const k of time) out[k] = String(mine[k] ?? "") > String(theirs[k] ?? "") ? mine[k] : theirs[k];
  return out;
}

export function createSpaceSync(deps: {
  workspaceId: string;
  transport: SyncTransport;
  journal: () => SyncJournal | null;
  randomUUID: () => string;
  now?: () => number;
  onStatus?: (s: SyncStatus) => void;
}) {
  const now = deps.now ?? (() => Date.now());
  let status: SyncStatus = { phase: "idle", pending: 0, conflicts: 0, lastSyncedAt: null, error: null };
  let running: Promise<number> | null = null;
  const emit = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch };
    deps.onStatus?.(status);
  };
  const J = () => {
    const j = deps.journal();
    if (!j) throw Error("SYNC_JOURNAL_CLOSED");
    return j;
  };
  const one = async <T>(d: SqlDriver, sql: string, p: SqlParam[] = []) =>
    (await d.select<T>(sql, p))[0] as T | undefined;
  const meta = async (d: SqlDriver, k: string) =>
    (await one<{ v: string }>(d, "SELECT v FROM wjb_sync_meta WHERE k = ?", [k]))?.v ?? null;
  const setMeta = (k: string, v: string | null): SqlStatement =>
    v === null
      ? { sql: "DELETE FROM wjb_sync_meta WHERE k = ?", params: [k] }
      : {
          sql: "INSERT INTO wjb_sync_meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
          params: [k, v],
        };
  const schemaOf = async (d: SqlDriver) => Number((await meta(d, "sourceSchema")) ?? "20");
  const sectionIds = async (d: SqlDriver) =>
    new Set(
      (
        await d.select<{ id: string }>("SELECT id FROM kanban_section").catch(() => [] as { id: string }[])
      ).map((r) => r.id),
    );
  const pkWhere = (pk: string[]) => pk.map((c) => `${q(c)} = ?`).join(" AND ");
  const readRow = async (d: SqlDriver, schema: number, table: string, pkVals: unknown[]) =>
    (await one<Row>(
      d,
      `SELECT * FROM ${q(table)} WHERE ${pkWhere(mapper.primaryKey(schema, table))}`,
      pkVals as SqlParam[],
    )) ?? null;
  const baseOf = async (d: SqlDriver, table: string, key: string) =>
    (await one<Base>(d, "SELECT rev, hash, value FROM wjb_sync_base WHERE tbl = ? AND key = ?", [
      table,
      key,
    ])) ?? null;
  const putBase = (table: string, key: string, rev: number, value: Row | null): SqlStatement => ({
    sql: "INSERT INTO wjb_sync_base(tbl, key, rev, hash, value) VALUES(?, ?, ?, ?, ?) ON CONFLICT(tbl, key) DO UPDATE SET rev = excluded.rev, hash = excluded.hash, value = excluded.value",
    params: [table, key, rev, value === null ? "" : hash(value), value === null ? null : canonical(value)],
  });
  const parse = (s: string | null | undefined) => (s ? (JSON.parse(s) as Row) : null);

  async function counts(d: SqlDriver) {
    const c = await one<{ p: number; c: number }>(
      d,
      "SELECT (SELECT count(*) FROM wjb_sync_outbox) AS p, (SELECT count(*) FROM wjb_sync_conflict) AS c",
    );
    return { pending: Number(c?.p ?? 0), conflicts: Number(c?.c ?? 0) };
  }

  /** 그림 해시 → 서버 참조(없으면 새 객체 ID를 정해 올릴 목록에) */
  async function assetRefs(d: SqlDriver, rows: { table: string; row: Row }[]) {
    const known = new Map<string, MappedAsset>();
    const uploads: { objectId: string; sha256: string; bytes: Uint8Array }[] = [];
    for (const { table, row } of rows) {
      if (table !== "note_asset" && table !== "cabi_asset") continue;
      for (const f of ["data", "thumb"]) {
        const b64 = row[f];
        if (typeof b64 !== "string" || known.has(b64)) continue;
        const bytes = base64ToBytes(b64);
        const sha = sha256Hex(bytes);
        const hit = await one<{ object_id: string; bytes: number }>(
          d,
          "SELECT object_id, bytes FROM wjb_sync_asset WHERE sha256 = ?",
          [sha],
        );
        const ref = hit
          ? { objectId: hit.object_id, sha256: sha, bytes: Number(hit.bytes) }
          : { objectId: deps.randomUUID(), sha256: sha, bytes: bytes.length };
        if (!hit) uploads.push({ objectId: ref.objectId, sha256: sha, bytes });
        known.set(b64, ref);
      }
    }
    return { known, uploads };
  }

  /** 온라인 기록 → 이 기기 행(그림은 받아서 base64). 이 기기 전용 값(장치 설정·폴더 경로)은 지금 행 것을 지킨다 */
  async function toLocal(
    d: SqlDriver,
    schema: number,
    table: string,
    value: Row,
    local: Row | null,
  ): Promise<Row> {
    const refs: MappedAsset[] = [];
    for (const f of ["dataRef", "thumbRef"]) {
      const r = value[f] as MappedAsset | null | undefined;
      if (r && typeof r === "object") refs.push(r);
    }
    const files = new Map<string, Uint8Array>();
    for (const r of refs) {
      files.set(r.objectId, await deps.transport.fetchAsset(deps.workspaceId, r.objectId, r.sha256, r.bytes));
    }
    const rows = restorer.toRows(
      {
        header: { sourceSchema: schema, assets: refs } as never,
        records: [{ table, key: "0".repeat(64), value }],
      },
      (id: string) => files.get(id),
    ) as Record<string, Row[]>;
    const row = rows[table]?.[0];
    if (!row) throw Error("SYNC_RESTORE");
    if (table === "app_meta" && row.key === "settings" && local) {
      // 서버 = 공간 공용 설정만. 이 기기 설정(백업·AI·화면)은 그대로, 칸반 열 순서·아이콘만 공용
      const mine = JSON.parse(String(local.value ?? "{}")) as Row;
      const theirs = JSON.parse(String(row.value)) as Row;
      const ui = { ...((mine.ui as Row) ?? {}) };
      if (theirs.ui && typeof theirs.ui === "object") Object.assign(ui, theirs.ui as Row);
      row.value = JSON.stringify({ ...mine, ...theirs, ...(Object.keys(ui).length ? { ui } : {}) });
    }
    if (table === "cabinet_item" && row.target === UNBOUND_FOLDER && local && local.target !== UNBOUND_FOLDER)
      row.target = local.target; // 이 기기에서 다시 지정한 폴더 경로는 기기마다
    void d;
    return row;
  }
  function upsert(schema: number, table: string, row: Row): SqlStatement {
    const pk = mapper.primaryKey(schema, table);
    const cols = Object.keys(row);
    const rest = cols.filter((c) => !pk.includes(c));
    return {
      sql:
        `INSERT INTO ${q(table)}(${cols.map(q).join(", ")}) VALUES(${cols.map(() => "?").join(", ")}) ` +
        `ON CONFLICT(${pk.map(q).join(", ")}) DO ${rest.length ? `UPDATE SET ${rest.map((c) => `${q(c)} = excluded.${q(c)}`).join(", ")}` : "NOTHING"}`,
      params: cols.map((c) => row[c] as SqlParam),
    };
  }
  const remove = (schema: number, table: string, pkVals: unknown[]): SqlStatement => ({
    sql: `DELETE FROM ${q(table)} WHERE ${pkWhere(mapper.primaryKey(schema, table))}`,
    params: pkVals as SqlParam[],
  });
  /** 받은 것을 적용하는 묶음 — 대기열·앱 트리거 끄기, 외래 키는 끝에 */
  async function applyBatch(d: SqlDriver, writes: SqlStatement[], tail: SqlStatement[]) {
    const triggers = await d.select<{ name: string; sql: string }>(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name NOT LIKE ?",
      [`${SYNC_PREFIX}%`],
    );
    const statements: SqlStatement[] = [
      { sql: "PRAGMA defer_foreign_keys = ON" },
      { sql: "UPDATE wjb_sync_flag SET applying = 1 WHERE id = 1" },
      ...(writes.length ? triggers.map((t) => ({ sql: `DROP TRIGGER ${q(t.name)}` })) : []),
      ...writes,
      ...(writes.length ? triggers.map((t) => ({ sql: t.sql })) : []),
      { sql: "UPDATE wjb_sync_flag SET applying = 0 WHERE id = 1" },
      ...tail,
    ];
    await d.batch(statements);
  }
  const pkOf = (schema: number, table: string, v: Row) => mapper.primaryKey(schema, table).map((c) => v[c]);

  /** 대기열 → 보낼 변경(지금 행 기준). 변화 없는 항목은 지울 목록으로 */
  async function capture(d: SqlDriver) {
    const schema = await schemaOf(d);
    const sections = await sectionIds(d);
    const blocked = new Set(
      (await d.select<{ tbl: string; key: string }>("SELECT tbl, key FROM wjb_sync_conflict")).map(
        (r) => `${r.tbl}\0${r.key}`,
      ),
    );
    const outbox = await d.select<{ tbl: string; pk: string; at: number }>(
      `SELECT tbl, pk, at FROM wjb_sync_outbox ORDER BY at, tbl, pk LIMIT ${OUTBOX_PAGE}`,
    );
    const rows: { e: Entry; row: Row | null }[] = [];
    for (const o of outbox) {
      const pkVals = JSON.parse(o.pk) as unknown[];
      const e = { ...o, key: hash([o.tbl, pkVals]) };
      if (blocked.has(`${o.tbl}\0${e.key}`)) continue;
      rows.push({ e, row: await readRow(d, schema, o.tbl, pkVals) });
    }
    const { known, uploads } = await assetRefs(
      d,
      rows.filter((r) => r.row).map((r) => ({ table: r.e.tbl, row: r.row! })),
    );
    const changes: { change: Change; e: Entry }[] = [];
    const drop: Entry[] = [];
    for (const { e, row } of rows) {
      const base = await baseOf(d, e.tbl, e.key);
      if (!row) {
        if (base && base.value !== null)
          changes.push({ e, change: { table: e.tbl, key: e.key, baseRev: base.rev, value: null } });
        else drop.push(e);
        continue;
      }
      const m = mapper.mapRow(schema, e.tbl, row, {
        sectionIds: sections,
        assetRef: (b64) => known.get(b64) ?? null,
      });
      if (!m || (base && base.hash === hash(m.value))) {
        drop.push(e);
        continue;
      }
      changes.push({
        e,
        change: { table: e.tbl, key: m.key, baseRev: base ? base.rev : null, value: m.value },
      });
    }
    return { schema, changes, drop, uploads, full: outbox.length >= OUTBOX_PAGE };
  }
  const dropEntries = (es: Entry[]): SqlStatement[] =>
    es.map((e) => ({
      sql: "DELETE FROM wjb_sync_outbox WHERE tbl = ? AND pk = ? AND at = ?",
      params: [e.tbl, e.pk, e.at],
    }));

  /** 충돌 하나 처리: 칸 합치기가 되면 이 기기에 적용하고 기준을 서버 판으로(다시 보냄), 안 되면 충돌로 보존 */
  async function onConflict(
    d: SqlDriver,
    schema: number,
    table: string,
    key: string,
    pkVals: unknown[],
    server: { rev: number | null; value: Row | null },
    local: Row | null,
  ): Promise<SqlStatement[]> {
    const base = await baseOf(d, table, key);
    const baseVal = parse(base?.value ?? null);
    const doc = DOCUMENT_TABLES.has(table);
    if (local && server.value && !doc) {
      const merged = merge3(baseVal, local, server.value);
      if (merged) {
        const current = await readRow(d, schema, table, pkVals);
        const row = await toLocal(d, schema, table, merged, current);
        return [
          ...(canonical(merged) === canonical(local) ? [] : [upsert(schema, table, row)]),
          putBase(table, key, server.rev ?? 0, server.value),
        ];
      }
    }
    if (local && server.value && canonical(local) === canonical(server.value))
      return [putBase(table, key, server.rev ?? 0, server.value)];
    return [
      {
        sql: "INSERT INTO wjb_sync_conflict(tbl, key, pk, server_rev, server_value, at) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(tbl, key) DO UPDATE SET server_rev = excluded.server_rev, server_value = excluded.server_value, at = excluded.at",
        params: [
          table,
          key,
          JSON.stringify(pkVals),
          server.rev,
          server.value === null ? null : canonical(server.value),
          now(),
        ],
      },
    ];
  }

  async function pushOnce(): Promise<number> {
    const j = J();
    // 응답을 못 받은 지난 요청이 있으면 같은 번호로 다시(서버가 같은 결과를 돌려줌)
    const prior = await j.exclusive(() => meta(j.driver, "pendingPush"));
    const cap = prior
      ? null
      : await j.exclusive(async () => {
          const c = await capture(j.driver);
          if (c.drop.length) await j.driver.batch(dropEntries(c.drop));
          return c;
        });
    if (cap)
      for (const u of cap.uploads)
        await deps.transport.uploadAsset(deps.workspaceId, u.objectId, u.sha256, u.bytes);
    if (cap?.uploads.length)
      await j.exclusive(() =>
        j.driver.batch(
          cap!.uploads.map((u) => ({
            sql: "INSERT OR IGNORE INTO wjb_sync_asset(sha256, object_id, bytes) VALUES(?, ?, ?)",
            params: [u.sha256, u.objectId, u.bytes.length],
          })),
        ),
      );
    let pushed = 0;
    const chunks: { opId: string; changes: Change[]; entries: Entry[] }[] = [];
    if (prior) chunks.push(JSON.parse(prior));
    else if (cap) {
      let cur: { opId: string; changes: Change[]; entries: Entry[] } | null = null,
        size = 0;
      for (const { change, e } of cap.changes) {
        const n = canonical(change).length + 64;
        if (!cur || cur.changes.length >= PUSH_MAX_CHANGES || size + n > PUSH_MAX_BYTES) {
          cur = { opId: deps.randomUUID(), changes: [], entries: [] };
          chunks.push(cur);
          size = 0;
        }
        cur.changes.push(change);
        cur.entries.push(e);
        size += n;
      }
    }
    const schema = cap?.schema ?? (await j.exclusive(() => schemaOf(j.driver)));
    for (const chunk of chunks) {
      await j.exclusive(() => j.driver.batch([setMeta("pendingPush", JSON.stringify(chunk))]));
      const r = (await deps.transport.call("push", {
        workspaceId: deps.workspaceId,
        opId: chunk.opId,
        changes: chunk.changes,
      })) as {
        applied: boolean;
        records?: { table: string; key: string; rev: number }[];
        conflicts?: { table: string; key: string; rev: number | null; exists: boolean; value: Row | null }[];
      };
      await j.exclusive(async () => {
        const d = J().driver;
        if (r.applied) {
          const byKey = new Map(chunk.changes.map((c) => [`${c.table}\0${c.key}`, c]));
          await d.batch([
            ...(r.records ?? []).map((x) =>
              putBase(x.table, x.key, x.rev, byKey.get(`${x.table}\0${x.key}`)?.value ?? null),
            ),
            ...dropEntries(chunk.entries),
            setMeta("pendingPush", null),
          ]);
          pushed += chunk.changes.length;
          return;
        }
        // 충돌: 그 기록만 따로(합치기 또는 보존), 나머지는 다음 차례에 새 요청으로 다시 보낸다
        const writes: SqlStatement[] = [];
        for (const c of r.conflicts ?? []) {
          const mine = chunk.changes.find((x) => x.table === c.table && x.key === c.key);
          const entry = chunk.entries[chunk.changes.indexOf(mine!)];
          if (!mine || !entry) continue;
          writes.push(
            ...(await onConflict(
              d,
              schema,
              c.table,
              c.key,
              JSON.parse(entry.pk) as unknown[],
              { rev: c.rev, value: c.exists ? c.value : null },
              mine.value,
            )),
          );
        }
        await applyBatch(
          d,
          writes.filter((w) => !/^INSERT INTO wjb_sync_(base|conflict)/.test(w.sql)),
          [
            ...writes.filter((w) => /^INSERT INTO wjb_sync_(base|conflict)/.test(w.sql)),
            setMeta("pendingPush", null),
          ],
        );
      });
      if (!r.applied) return pushed + (await pushOnce());
    }
    // 대기열이 한 번에 읽는 수보다 많았으면 이어서(진전이 있을 때만 — 충돌로 막힌 것만 남으면 멈춤)
    if (cap?.full && cap.changes.length + cap.drop.length > 0) return pushed + (await pushOnce());
    return pushed;
  }

  async function pullOnce(): Promise<number> {
    const j = J();
    let applied = 0;
    for (let guard = 0; guard < 200; guard++) {
      const cursor = (await j.exclusive(() => meta(j.driver, "cursor"))) ?? "0";
      const r = (await deps.transport.call("pull", {
        workspaceId: deps.workspaceId,
        after: cursor,
        limit: PULL_LIMIT,
      })) as {
        changes: { table: string; key: string; value: Row | null; rev: number }[];
        more: boolean;
        next: string;
      };
      // 그림은 묶음 밖에서 먼저 받아 둔다(캐시) — 적용 묶음 안에서는 캐시에서 읽는다
      for (const c of r.changes)
        for (const f of ["dataRef", "thumbRef"]) {
          const ref = c.value?.[f] as MappedAsset | null | undefined;
          if (ref && typeof ref === "object")
            await deps.transport.fetchAsset(deps.workspaceId, ref.objectId, ref.sha256, ref.bytes);
        }
      await j.exclusive(async () => {
        const d = J().driver;
        const schema = await schemaOf(d);
        const sections = await sectionIds(d);
        const writes: SqlStatement[] = [],
          tail: SqlStatement[] = [];
        for (const c of r.changes) {
          if (c.table === "kanban_ctx") continue;
          const base = await baseOf(d, c.table, c.key);
          if (base && base.rev >= c.rev) continue; // 내가 보낸 것이 돌아온 것
          const baseVal = parse(base?.value ?? null);
          const pkSource = c.value ?? baseVal;
          if (!pkSource) {
            tail.push(putBase(c.table, c.key, c.rev, null));
            continue;
          }
          const pkVals = pkOf(schema, c.table, pkSource);
          const pkText = JSON.stringify(pkVals);
          const local = await readRow(d, schema, c.table, pkVals);
          const waiting =
            !!(await one(d, "SELECT 1 AS x FROM wjb_sync_outbox WHERE tbl = ? AND pk = ?", [
              c.table,
              pkText,
            ])) ||
            !!(await one(d, "SELECT 1 AS x FROM wjb_sync_conflict WHERE tbl = ? AND key = ?", [
              c.table,
              c.key,
            ]));
          if (waiting) {
            const { known } = await assetRefs(d, local ? [{ table: c.table, row: local }] : []);
            const mine = local
              ? (mapper.mapRow(schema, c.table, local, {
                  sectionIds: sections,
                  assetRef: (b) => known.get(b) ?? null,
                })?.value ?? null)
              : null;
            for (const w of await onConflict(
              d,
              schema,
              c.table,
              c.key,
              pkVals,
              { rev: c.rev, value: c.value },
              mine,
            ))
              (/^INSERT INTO wjb_sync_(base|conflict)/.test(w.sql) ? tail : writes).push(w);
            if (mine && c.value && canonical(mine) === canonical(c.value))
              tail.push({
                sql: "DELETE FROM wjb_sync_outbox WHERE tbl = ? AND pk = ?",
                params: [c.table, pkText],
              });
            continue;
          }
          if (c.value === null) writes.push(remove(schema, c.table, pkVals));
          else writes.push(upsert(schema, c.table, await toLocal(d, schema, c.table, c.value, local)));
          tail.push(putBase(c.table, c.key, c.rev, c.value));
          applied++;
        }
        tail.push(setMeta("cursor", r.next));
        await applyBatch(d, writes, tail);
      });
      if (!r.more) break;
    }
    return applied;
  }

  async function refresh() {
    const j = deps.journal();
    if (!j) return;
    emit(await j.exclusive(() => counts(j.driver)));
  }

  /**
   * 보내고 받기(한 번에 하나). 받아서 이 기기에 적용한 기록 수를 돌려준다.
   * pull: false = 보내기만(고친 뒤 — 서버 호출을 반으로, 받기는 주기·창 복귀·[지금 동기화]에서)
   */
  function syncNow(opts: { pull?: boolean } = {}): Promise<number> {
    if (running) return running;
    const pull = opts.pull !== false;
    running = (async () => {
      emit({ phase: "syncing", error: null });
      try {
        await pushOnce();
        const got = pull ? await pullOnce() : 0;
        if (pull) await pushOnce(); // 받는 동안 합친 것
        emit({ phase: "idle", lastSyncedAt: now() });
        await refresh();
        return got;
      } catch (e) {
        const code = e instanceof Error ? e.message : String(e);
        emit({ phase: OFFLINE.test(code) ? "offline" : "error", error: code });
        await refresh().catch(() => undefined);
        return 0;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  async function conflicts(): Promise<ConflictItem[]> {
    const j = J();
    return j.exclusive(async () => {
      const d = j.driver;
      const schema = await schemaOf(d);
      const rows = await d.select<{
        tbl: string;
        key: string;
        pk: string;
        server_rev: number | null;
        server_value: string | null;
        at: number;
      }>("SELECT tbl, key, pk, server_rev, server_value, at FROM wjb_sync_conflict ORDER BY at");
      const out: ConflictItem[] = [];
      for (const r of rows) {
        const local = await readRow(d, schema, r.tbl, JSON.parse(r.pk) as unknown[]);
        out.push({
          table: r.tbl,
          key: r.key,
          local: local && strip(local),
          server: parse(r.server_value),
          serverRev: r.server_rev,
          at: Number(r.at),
        });
      }
      return out;
    });
  }
  /** 화면 표시용: 그림 본문은 빼고 */
  const strip = (row: Row) => {
    const o = { ...row };
    if ("data" in o) o.data = "(그림)";
    if ("thumb" in o) o.thumb = o.thumb ? "(그림)" : null;
    return o;
  };

  /** 충돌 고르기: 내 기기 / 서버 / 둘 다 보존 — 결과는 다음 동기화 때 보낸다 */
  async function resolve(table: string, key: string, choice: Resolution) {
    const j = J();
    await j.exclusive(async () => {
      const d = j.driver;
      const schema = await schemaOf(d);
      const c = await one<{ pk: string; server_rev: number | null; server_value: string | null }>(
        d,
        "SELECT pk, server_rev, server_value FROM wjb_sync_conflict WHERE tbl = ? AND key = ?",
        [table, key],
      );
      if (!c) return;
      const pkVals = JSON.parse(c.pk) as unknown[];
      const server = parse(c.server_value);
      const rev = c.server_rev ?? 0;
      const local = await readRow(d, schema, table, pkVals);
      const clear: SqlStatement = {
        sql: "DELETE FROM wjb_sync_conflict WHERE tbl = ? AND key = ?",
        params: [table, key],
      };
      const queue: SqlStatement = {
        sql: "INSERT OR REPLACE INTO wjb_sync_outbox(tbl, pk, at) VALUES(?, ?, ?)",
        params: [table, c.pk, now()],
      };
      if (choice === "mine") {
        // 서버 판을 기준으로 삼고 내 것을 다시 보낸다(서버 쪽은 판 기록에 남음)
        await d.batch([putBase(table, key, rev, server), clear, queue]);
        return;
      }
      const serverRow = server ? await toLocal(d, schema, table, server, local) : null;
      const takeServer = [
        ...(serverRow ? [upsert(schema, table, serverRow)] : [remove(schema, table, pkVals)]),
      ];
      if (choice === "server" || !local || !serverRow) {
        await applyBatch(d, takeServer, [
          putBase(table, key, rev, server),
          clear,
          { sql: "DELETE FROM wjb_sync_outbox WHERE tbl = ? AND pk = ?", params: [table, c.pk] },
        ]);
        return;
      }
      if (!BOTH_TABLES.has(table)) throw Error("SYNC_BOTH_UNSUPPORTED");
      // 둘 다 보존: 서버 것을 그 자리에, 내 것은 새 항목으로(기록·노트) / 문서는 상자를 합쳐서(메모 보드)
      const keep: SqlStatement[] = [];
      if (table === "entry_item" || table === "cabi_note") {
        const copy = { ...local, id: deps.randomUUID() } as Row;
        if (table === "cabi_note" && typeof copy.title === "string") copy.title = `${copy.title} (이 기기)`;
        keep.push(upsert(schema, table, copy));
      } else {
        const field = "doc";
        const mineDoc = JSON.parse(String(local[field])) as { boxes: Row[]; edges?: Row[] };
        const theirDoc = JSON.parse(String(serverRow[field])) as { boxes: Row[]; edges?: Row[] };
        const ids = new Map(theirDoc.boxes.map((b) => [b.id, canonical(b)]));
        for (const b of mineDoc.boxes) {
          if (!ids.has(b.id)) theirDoc.boxes.push(b);
          else if (ids.get(b.id) !== canonical(b))
            theirDoc.boxes.push({
              ...b,
              id: deps.randomUUID(),
              x: Number(b.x ?? 0) + 24,
              y: Number(b.y ?? 0) + 24,
            });
        }
        keep.push(upsert(schema, table, { ...serverRow, [field]: JSON.stringify(theirDoc) }));
      }
      // 서버 것을 적용(대기열 없이) → 기준 = 서버 판 → 보존한 내 것은 대기열이 있는 쓰기로(다음에 보냄)
      await applyBatch(d, takeServer, [putBase(table, key, rev, server), clear]);
      await d.batch(keep);
    });
  }

  return {
    get status() {
      return status;
    },
    refresh,
    syncNow,
    push: () => pushOnce(),
    pull: () => pullOnce(),
    conflicts,
    resolve,
  };
}
export type SpaceSync = ReturnType<typeof createSpaceSync>;
export type { MappedRecord };
