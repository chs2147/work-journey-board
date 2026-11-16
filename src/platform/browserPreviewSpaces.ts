// 브라우저 모드(개발·E2E)용 가짜 "내 온라인 공간" — 가짜 이관 서버(browserPreviewMigration)가 게시한 공간을 읽는다.
// 네트워크 없음, 메모리 캐시. ?spacesOffline=1 이면 서버에 닿지 못한 상황(받아 둔 공간만)
import { fakePublishedSpaces } from "./browserPreviewMigration";
import { createFakeSyncServer } from "../preview/fakeSyncServer";
import type { OnlineSpaceInfo, PreviewSpaces, SpaceDriver, SpaceJournalStore } from "./index";

const MH = "c".repeat(64);
const cache = new Map<string, Map<string, Uint8Array>>();
const enc = new TextEncoder();
const offline = () => new URLSearchParams(location.search).get("spacesOffline") === "1";
const info = (s: ReturnType<typeof fakePublishedSpaces>[number]): OnlineSpaceInfo => ({
  workspaceId: s.header.workspaceId,
  manifestHash: MH,
  records: s.records.length,
  assets: s.header.assets.length,
  assetBytes: (s.header.assets as { bytes?: number }[]).reduce((n, a) => n + (a.bytes ?? 0), 0),
  createdAt: s.createdAt,
  sourceSchema: Number(s.header.sourceSchema),
  workspace: label(s),
});
/** 025와 같은 규칙: 동기화된 설정 값이 있으면 그것, 없으면 게시본의 설정 — 이름·색·아이콘만 */
function label(s: ReturnType<typeof fakePublishedSpaces>[number]): OnlineSpaceInfo["workspace"] {
  const pub = (s.records as { table: string; key: string; value: { key?: string; value?: unknown } }[]).find(
    (r) => r.table === "app_meta" && r.value.key === "settings",
  );
  if (!pub) return null;
  const synced = fakeServer.record(s.header.workspaceId, "app_meta", pub.key);
  const v = (synced ? synced.value : pub.value) as { value?: unknown } | null;
  try {
    const w = (JSON.parse(String(v?.value)) as { workspace?: Record<string, unknown> }).workspace;
    if (typeof w?.name !== "string" || typeof w.color !== "string" || typeof w.icon !== "string") return null;
    return { name: w.name, color: w.color, icon: w.icon };
  } catch {
    return null;
  }
}

/** E-1 이 기기 일지 흉내 — 메모리(창을 새로 불러오면 사라짐). 실앱처럼 공간마다 연결 하나를 같이 쓴다 */
const journals = new Map<string, Uint8Array>();
const live = new Map<string, import("../data/drivers/sqlJs").SqlJsDriver>();
/** E-3 가짜 동기화 서버(019 규칙) — 게시한 가짜 공간의 기록·그림으로 시작. ?syncOffline=1 이면 연결 안 됨 */
const fakeServer = createFakeSyncServer((ws) => {
  const s = fakePublishedSpaces().find((x) => x.header.workspaceId === ws);
  if (!s) return null;
  const assets = new Map<string, Uint8Array>();
  for (const a of s.header.assets as { objectId: string }[]) {
    const b = s.body(a.objectId);
    if (b) assets.set(a.objectId, b);
  }
  return { records: s.records as never, assets };
});
if (typeof location !== "undefined" && new URLSearchParams(location.search).get("syncOffline") === "1")
  fakeServer.setOffline(true);
// ?syncSlow=ms 이면 느린 연결(첫 동기화 상한 시험)
if (typeof location !== "undefined") {
  const slow = Number(new URLSearchParams(location.search).get("syncSlow") ?? 0);
  if (slow > 0) fakeServer.setDelay(slow);
}
/** 브라우저 E2E 전용: 다른 기기가 서버에 먼저 고친 것을 흉내(가상 공간·가짜 서버에만, 실앱에는 없음) */
export const browserFakeSyncServer = fakeServer;
if (typeof window !== "undefined")
  Object.assign(globalThis, {
    __wjbFakeSync: {
      /** 업무 기록 하나(entryId 없으면 서버 첫 기록)의 글을 "다른 기기"가 고친 것으로 서버에 올린다 → 기록 ID */
      async editEntryElsewhere(workspaceId: string, text: string, entryId?: string) {
        const t = fakeServer.transport("other-device");
        const { hash } = await import("../../poc/v2-sync/hash-core.mjs");
        const s = fakePublishedSpaces().find((x) => x.header.workspaceId === workspaceId);
        const id =
          entryId ??
          String(
            (s?.records as { table: string; value: { id: string } }[]).find((r) => r.table === "entry_item")
              ?.value.id,
          );
        const key = hash(["entry_item", [id]]);
        await t.call("pull", { workspaceId, after: "0", limit: 1 }); // 서버 공간 준비
        const cur = fakeServer.record(workspaceId, "entry_item", key);
        if (!cur?.value) throw Error("NO_RECORD");
        await t.call("push", {
          workspaceId,
          opId: crypto.randomUUID(),
          changes: [{ table: "entry_item", key, baseRev: cur.rev, value: { ...cur.value, text } }],
        });
        return id;
      },
    },
  });

export const browserSpaceJournal: SpaceJournalStore = {
  exists: async (ws) => journals.has(ws),
  async create(ws, bytes) {
    if (journals.has(ws)) throw new Error("JOURNAL_EXISTS");
    journals.set(ws, bytes.slice());
  },
  async open(ws): Promise<SpaceDriver> {
    const bytes = journals.get(ws);
    if (!bytes) throw new Error("JOURNAL_MISSING");
    let d = live.get(ws);
    if (!d) {
      const { loadSql } = await import("../preview/migrationSession");
      const { SqlJsDriver } = await import("../data/drivers/sqlJs");
      d = new SqlJsDriver(new (await loadSql()).Database(bytes), "온라인 공간(이 기기, 브라우저 모드)");
      live.set(ws, d);
    }
    const db = d;
    const keep = () => journals.set(ws, db.exportBytes());
    return {
      label: db.label,
      select: (sql, params) => db.select(sql, params),
      execute: (sql, params) => db.execute(sql, params),
      batch: (statements) => db.batch(statements),
      exportBytes: async () => db.exportBytes(),
      // 닫기 = 바이트로 남기기만(같은 연결을 다른 쪽이 쓰고 있을 수 있음 — 실앱 Rust 연결 풀과 같은 뜻)
      async close() {
        keep();
      },
    };
  },
};

export const browserPreviewSpaces: PreviewSpaces = {
  async list() {
    if (offline())
      return {
        offline: true,
        workspaces: fakePublishedSpaces()
          .filter((s) => cache.has(s.header.workspaceId))
          .map(info),
      };
    return { workspaces: fakePublishedSpaces().map(info) };
  },
  async sync(workspaceId) {
    const s = fakePublishedSpaces().find((x) => x.header.workspaceId === workspaceId);
    if (!s) throw new Error("READ_NOT_FOUND");
    const had = cache.has(workspaceId);
    const files = new Map<string, Uint8Array>();
    const { assets, ...header } = s.header as { assets: { objectId: string; sha256: string }[] } & Record<
      string,
      unknown
    >;
    files.set(
      "header.json",
      enc.encode(JSON.stringify({ workspaceId, manifestHash: MH, createdAt: s.createdAt, header, assets })),
    );
    files.set("records.json", enc.encode(JSON.stringify(s.records)));
    for (const a of assets) {
      const b = s.body(a.objectId);
      if (!b) throw new Error("ASSET_HTTP_404");
      files.set(`${a.sha256}.bin`, b);
    }
    cache.set(workspaceId, files);
    return {
      workspaceId,
      manifestHash: MH,
      records: s.records.length,
      assets: assets.length,
      fromCache: had,
      stale: false,
    };
  },
  async read(workspaceId, name) {
    const b = cache.get(workspaceId)?.get(name);
    if (!b) throw new Error("CACHE_MISSING");
    return b;
  },
  async remove(workspaceId) {
    cache.delete(workspaceId);
    journals.delete(workspaceId);
    live.delete(workspaceId);
  },
  journal: browserSpaceJournal,
  transport: fakeServer.transport("browser-device"),
};
