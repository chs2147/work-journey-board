// 브라우저 모드(개발·E2E)용 가짜 "내 온라인 공간" — 가짜 이관 서버(browserPreviewMigration)가 게시한 공간을 읽는다.
// 네트워크 없음, 메모리 캐시. ?spacesOffline=1 이면 서버에 닿지 못한 상황(받아 둔 공간만)
import { fakePublishedSpaces } from "./browserPreviewMigration";
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
});

/** E-1 이 기기 일지 흉내 — 메모리(창을 새로 불러오면 사라짐). 닫을 때 바이트로 남겨 다시 열 수 있다 */
const journals = new Map<string, Uint8Array>();
export const browserSpaceJournal: SpaceJournalStore = {
  exists: async (ws) => journals.has(ws),
  async create(ws, bytes) {
    if (journals.has(ws)) throw new Error("JOURNAL_EXISTS");
    journals.set(ws, bytes.slice());
  },
  async open(ws): Promise<SpaceDriver> {
    const bytes = journals.get(ws);
    if (!bytes) throw new Error("JOURNAL_MISSING");
    const { loadSql } = await import("../preview/migrationSession");
    const { SqlJsDriver } = await import("../data/drivers/sqlJs");
    const d = new SqlJsDriver(new (await loadSql()).Database(bytes), "온라인 공간(이 기기, 브라우저 모드)");
    const keep = () => journals.set(ws, d.exportBytes());
    return {
      label: d.label,
      select: (sql, params) => d.select(sql, params),
      execute: (sql, params) => d.execute(sql, params),
      batch: (statements) => d.batch(statements),
      exportBytes: async () => d.exportBytes(),
      async close() {
        keep();
        await d.close();
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
  },
  journal: browserSpaceJournal,
};
