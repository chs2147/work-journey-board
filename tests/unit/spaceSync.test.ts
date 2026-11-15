// @vitest-environment node
// E-3·E-4 동기화 엔진 — 같은 캐시에서 만든 두 기기 일지(sql.js) + 가짜 서버(019 규칙). 가상 샘플만.
import { describe, expect, it } from "vitest";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { randomUUID } from "node:crypto";
import { migrate } from "../../src/data/migrate";
import { openSqlJs, SqlJsDriver } from "../../src/data/drivers/sqlJs";
import { seedSample } from "../../src/data/seed";
import sample from "../../fixtures/sample-showcase.json";
import { prepareCopy } from "../../src/preview/migrationEngine";
import { derivedId } from "../../src/preview/migrationSession";
import { ensureSpaceJournal } from "../../src/preview/spaceJournal";
import { createSpaceSync, merge3, type SyncTransport } from "../../src/preview/spaceSync";
import { createFakeSyncServer } from "../../src/preview/fakeSyncServer";
import { createWorkspaceMapper } from "../../poc/v2-migration/workspace-map-core.mjs";
import { base64ToBytes, bytesToBase64, hash, sha256Hex } from "../../poc/v2-sync/hash-core.mjs";
import { SECTION_ICONS } from "../../src/shared/sectionIcons";
import type { PreviewSpaces, SpaceJournalStore } from "../../src/platform";
import type { SqlDriver } from "../../src/data/driver";

const enc = new TextEncoder();
async function setup() {
  const d = await openSqlJs();
  await migrate(d);
  await seedSample(d, sample as never);
  const SQL = await initSqlJs();
  const job = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  let n = 0;
  const p = prepareCopy(SQL, d.exportBytes(), {
    workspaceId: derivedId(job, "workspace"),
    sourceWorkspaceId: derivedId(job, "source"),
    randomUUID: () => derivedId(job, `object-${++n}`),
  });
  const { assets, ...header } = p.header;
  const files = new Map<string, Uint8Array>([
    [
      "header.json",
      enc.encode(
        JSON.stringify({
          workspaceId: p.workspaceId,
          manifestHash: "c".repeat(64),
          createdAt: null,
          header,
          assets,
        }),
      ),
    ],
    ["records.json", enc.encode(JSON.stringify(p.pages.flat()))],
  ]);
  for (const a of assets) files.set(`${a.sha256}.bin`, p.assetBytes.get(a.objectId)!);
  const server = createFakeSyncServer((ws) =>
    ws === p.workspaceId ? { records: p.pages.flat(), assets: p.assetBytes } : null,
  );
  const spaces = { read: async (_w: string, name: string) => files.get(name)! } as unknown as PreviewSpaces;
  const device = async (name: string, transport?: SyncTransport) => {
    const store = memJournal(SQL);
    await ensureSpaceJournal(SQL, spaces, store, p.workspaceId);
    const driver = await store.open(p.workspaceId);
    let status = "";
    const sync = createSpaceSync({
      workspaceId: p.workspaceId,
      transport: transport ?? server.transport(name),
      journal: () => ({ driver, exclusive: (f) => f() }),
      randomUUID,
      onStatus: (s) => (status = s.phase),
    });
    return { driver, sync, status: () => status };
  };
  return { SQL, p, server, device };
}
function memJournal(SQL: SqlJsStatic): SpaceJournalStore {
  const dbs = new Map<string, Database>();
  return {
    exists: async (w) => dbs.has(w),
    async create(w, b) {
      dbs.set(w, new SQL.Database(b));
    },
    async open(w) {
      const d = new SqlJsDriver(dbs.get(w)!);
      return {
        label: "시험",
        select: (s, x) => d.select(s, x),
        execute: (s, x) => d.execute(s, x),
        batch: (s) => d.batch(s),
        exportBytes: async () => d.exportBytes(),
        close: async () => undefined,
      };
    },
  };
}
const one = async <T>(d: SqlDriver, sql: string, p: unknown[] = []) =>
  (await d.select<T>(sql, p as never))[0]!;
const outbox = async (d: SqlDriver) =>
  (await one<{ n: number }>(d, "SELECT count(*) n FROM wjb_sync_outbox")).n;
const firstEntry = async (d: SqlDriver) =>
  one<{ id: string; text: string; depth: number }>(
    d,
    "SELECT id, text, depth FROM entry_item ORDER BY id LIMIT 1",
  );
const entry = (d: SqlDriver, id: string) =>
  one<{ text: string; depth: number; updated_at: string } | undefined>(
    d,
    "SELECT text, depth, updated_at FROM entry_item WHERE id = ?",
    [id],
  );

describe("E-3 동기화 엔진(두 기기 + 가짜 서버)", () => {
  it("행 사상(mapRow) = 이관 때 만든 기록과 한 글자도 같다(모든 표·그림 참조 포함)", async () => {
    const { p, device } = await setup();
    const { driver: d } = await device("A");
    const mapper = createWorkspaceMapper({ hash, sectionIconIds: new Set(SECTION_ICONS.map((i) => i.id)) });
    const sections = new Set(
      (await d.select<{ id: string }>("SELECT id FROM kanban_section")).map((r) => r.id),
    );
    const bySha = new Map(p.header.assets.map((a) => [a.sha256, a]));
    const tables = (
      await d.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'wjb_sync_%'",
      )
    ).map((r) => r.name);
    const mine: string[] = [];
    for (const t of tables)
      for (const row of await d.select<Record<string, unknown>>(`SELECT * FROM "${t}"`)) {
        const m = mapper.mapRow(20, t, row, {
          sectionIds: sections,
          assetRef: (b64) => bySha.get(sha256Hex(base64ToBytes(b64))) ?? null,
        });
        if (m) mine.push(`${m.table}\0${m.key}\0${hash(m.value)}`);
      }
    const theirs = p.pages.flat().map((r) => `${r.table}\0${r.key}\0${hash(r.value)}`);
    expect(mine.sort()).toEqual(theirs.sort());
  });

  it("A가 고치면 → 서버 판 1 → B가 받아 그대로 적용(받은 것은 대기열에 안 쌓임)", async () => {
    const { device } = await setup();
    const A = await device("A"),
      B = await device("B");
    const e = await firstEntry(A.driver);
    await A.driver.execute("UPDATE entry_item SET text = ?, updated_at = ? WHERE id = ?", [
      "A가 고침",
      "2026-11-15T01:00:00.000Z",
      e.id,
    ]);
    expect(await outbox(A.driver)).toBe(1);
    await A.sync.syncNow();
    expect(await outbox(A.driver)).toBe(0);
    expect(A.status()).toBe("idle");
    expect(await B.sync.syncNow()).toBe(1);
    expect((await entry(B.driver, e.id))?.text).toBe("A가 고침");
    expect(await outbox(B.driver)).toBe(0);
    // 다시 받아도 그대로(내가 보낸 것이 돌아와도 무시)
    expect(await A.sync.syncNow()).toBe(0);
    expect(await B.sync.syncNow()).toBe(0);
  });

  it("같은 기록의 다른 칸 = 합침(고친 시각은 늦은 쪽), 같은 칸 = 충돌로 보존 → 내 기기/서버/둘 다", async () => {
    const { device, server, p } = await setup();
    const A = await device("A"),
      B = await device("B");
    const e = await firstEntry(A.driver);
    await A.driver.execute("UPDATE entry_item SET text = ?, updated_at = ? WHERE id = ?", [
      "A 글",
      "2026-11-15T01:00:00.000Z",
      e.id,
    ]);
    await B.driver.execute("UPDATE entry_item SET depth = ?, updated_at = ? WHERE id = ?", [
      e.depth + 1,
      "2026-11-15T02:00:00.000Z",
      e.id,
    ]);
    await A.sync.syncNow();
    await B.sync.syncNow();
    await A.sync.syncNow();
    for (const X of [A, B]) {
      const r = await entry(X.driver, e.id);
      expect(r).toMatchObject({ text: "A 글", depth: e.depth + 1, updated_at: "2026-11-15T02:00:00.000Z" });
      expect(await outbox(X.driver)).toBe(0);
    }
    // 같은 칸
    await A.driver.execute("UPDATE entry_item SET text = 'A 두 번째' WHERE id = ?", [e.id]);
    await B.driver.execute("UPDATE entry_item SET text = 'B 두 번째' WHERE id = ?", [e.id]);
    await A.sync.syncNow();
    await B.sync.syncNow();
    expect((await entry(B.driver, e.id))?.text).toBe("B 두 번째"); // 조용히 덮어쓰지 않음
    const list = await B.sync.conflicts();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      table: "entry_item",
      local: { text: "B 두 번째" },
      server: { text: "A 두 번째" },
    });
    expect(B.sync.status.conflicts).toBe(1);
    // 다른 기록은 그동안에도 동기화된다
    const other = await one<{ id: string }>(
      B.driver,
      "SELECT id FROM entry_item WHERE id <> ? ORDER BY id LIMIT 1",
      [e.id],
    );
    await B.driver.execute("UPDATE entry_item SET text = 'B 다른 기록' WHERE id = ?", [other.id]);
    await B.sync.syncNow();
    await A.sync.syncNow();
    expect((await entry(A.driver, other.id))?.text).toBe("B 다른 기록");
    // 내 기기 것으로 → 서버·A도 B 것
    await B.sync.resolve(list[0]!.table, list[0]!.key, "mine");
    await B.sync.syncNow();
    await A.sync.syncNow();
    expect((await entry(A.driver, e.id))?.text).toBe("B 두 번째");
    expect(server.record(p.workspaceId, "entry_item", list[0]!.key)?.value).toMatchObject({
      text: "B 두 번째",
    });
    // 서버 것으로
    await A.driver.execute("UPDATE entry_item SET text = 'A 세 번째' WHERE id = ?", [e.id]);
    await B.driver.execute("UPDATE entry_item SET text = 'B 세 번째' WHERE id = ?", [e.id]);
    await A.sync.syncNow();
    await B.sync.syncNow();
    const [c2] = await B.sync.conflicts();
    await B.sync.resolve(c2!.table, c2!.key, "server");
    expect((await entry(B.driver, e.id))?.text).toBe("A 세 번째");
    expect(await outbox(B.driver)).toBe(0);
    // 둘 다 보존 → 서버 것 자리 + 내 것은 새 기록
    await A.driver.execute("UPDATE entry_item SET text = 'A 네 번째' WHERE id = ?", [e.id]);
    await B.driver.execute("UPDATE entry_item SET text = 'B 네 번째' WHERE id = ?", [e.id]);
    await A.sync.syncNow();
    await B.sync.syncNow();
    const [c3] = await B.sync.conflicts();
    await B.sync.resolve(c3!.table, c3!.key, "both");
    await B.sync.syncNow();
    await A.sync.syncNow();
    for (const X of [A, B]) {
      const texts = (
        await X.driver.select<{ text: string }>("SELECT text FROM entry_item WHERE text LIKE '%네 번째'")
      )
        .map((r) => r.text)
        .sort();
      expect(texts).toEqual(["A 네 번째", "B 네 번째"]);
    }
    expect(B.sync.status.conflicts).toBe(0);
  });

  it("문서(주간 메모)는 칸 합치기 없이 충돌 → 둘 다 보존 = 상자 합치기", async () => {
    const { device } = await setup();
    const A = await device("A"),
      B = await device("B");
    const w = await one<{ week_id: string; doc: string }>(
      A.driver,
      "SELECT week_id, doc FROM week_note ORDER BY week_id LIMIT 1",
    );
    const doc = JSON.parse(w.doc) as { boxes: Record<string, unknown>[] };
    const withBox = (id: string) =>
      JSON.stringify({ ...doc, boxes: [...doc.boxes, { ...doc.boxes[0], id, x: 10, y: 10 }] });
    await A.driver.execute("UPDATE week_note SET doc = ? WHERE week_id = ?", [
      withBox("box-from-a"),
      w.week_id,
    ]);
    await B.driver.execute("UPDATE week_note SET doc = ? WHERE week_id = ?", [
      withBox("box-from-b"),
      w.week_id,
    ]);
    await A.sync.syncNow();
    await B.sync.syncNow();
    const [c] = await B.sync.conflicts();
    expect(c?.table).toBe("week_note");
    await B.sync.resolve(c!.table, c!.key, "both");
    await B.sync.syncNow();
    await A.sync.syncNow();
    for (const X of [A, B]) {
      const ids = (
        JSON.parse(
          (await one<{ doc: string }>(X.driver, "SELECT doc FROM week_note WHERE week_id = ?", [w.week_id]))
            .doc,
        ) as { boxes: { id: string }[] }
      ).boxes.map((b) => b.id);
      expect(ids).toContain("box-from-a");
      expect(ids).toContain("box-from-b");
    }
  });

  it("지우기 = 지움 표시로 전파, 새 그림 = 올린 뒤 참조만(서버 기록에 본문 없음) → 다른 기기가 받아 같은 그림", async () => {
    const { device, server, p } = await setup();
    const A = await device("A"),
      B = await device("B");
    const e = await firstEntry(A.driver);
    await A.driver.execute("DELETE FROM entry_item WHERE id = ?", [e.id]);
    const asset = await one<Record<string, unknown>>(A.driver, "SELECT * FROM note_asset LIMIT 1");
    const img = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9, 9]);
    const b64 = bytesToBase64(img);
    await A.driver.execute(
      "INSERT INTO note_asset(id, week_id, mime, data, width, height, bytes, created_at, thumb, thumb_mime) VALUES(?, ?, 'image/png', ?, 1, 1, ?, ?, NULL, NULL)",
      ["new-virtual-img", String(asset.week_id), b64, img.length, "2026-11-15T00:00:00.000Z"],
    );
    await A.sync.syncNow();
    const key = hash(["note_asset", ["new-virtual-img"]]);
    const rec = server.record(p.workspaceId, "note_asset", key)!;
    expect(JSON.stringify(rec.value)).not.toContain(b64);
    expect((rec.value as { dataRef: { sha256: string } }).dataRef.sha256).toBe(sha256Hex(img));
    await B.sync.syncNow();
    expect(await entry(B.driver, e.id)).toBeUndefined();
    expect(
      (await one<{ data: string }>(B.driver, "SELECT data FROM note_asset WHERE id = 'new-virtual-img'"))
        .data,
    ).toBe(b64);
    expect(await outbox(B.driver)).toBe(0);
  });

  it("오프라인이면 이 기기에 남고(대기 N건) 연결되면 보낸다 · 응답을 잃어도 같은 요청 번호로 다시 보내 한 번만 적용", async () => {
    const { device, server, p } = await setup();
    const A = await device("A");
    const e = await firstEntry(A.driver);
    await A.driver.execute("UPDATE entry_item SET text = '오프라인 편집' WHERE id = ?", [e.id]);
    server.setOffline(true);
    await A.sync.syncNow();
    expect(A.sync.status).toMatchObject({ phase: "offline", pending: 1 });
    server.setOffline(false);
    await A.sync.syncNow();
    expect(A.sync.status).toMatchObject({ phase: "idle", pending: 0 });
    // 응답 유실: 서버는 적용했지만 앱은 결과를 못 받음
    const base = server.transport("L");
    let lose = true;
    const lossy: SyncTransport = {
      ...base,
      async call(a, params) {
        const r = await base.call(a, params);
        if (a === "push" && lose) {
          lose = false;
          throw Error("NETWORK");
        }
        return r;
      },
    };
    const L = await device("L", lossy);
    await L.sync.syncNow(); // 받기만
    await L.driver.execute("UPDATE entry_item SET text = '응답 유실' WHERE id = ?", [e.id]);
    await L.sync.syncNow();
    expect(L.sync.status.phase).toBe("offline");
    const head = server.head(p.workspaceId);
    await L.sync.syncNow();
    expect(server.head(p.workspaceId)).toBe(head); // 다시 보낸 요청은 새로 적용되지 않음
    expect(L.sync.status).toMatchObject({ phase: "idle", pending: 0, conflicts: 0 });
  });

  it("merge3: 기준이 없으면 합치지 않는다", () => {
    expect(merge3(null, { a: 1 }, { a: 2 })).toBeNull();
    expect(merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 })).toEqual({ a: 2, b: 3 });
    expect(merge3({ a: 1 }, { a: 2 }, { a: 3 })).toBeNull();
  });
});
