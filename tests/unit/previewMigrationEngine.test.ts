// @vitest-environment node
// C-3 이관 엔진(Preview 앱 경로: sql.js + 순수 JS 해시)이 PoC Node 경로(node:sqlite + node:crypto)와
// 같은 결과를 내는지 — DB18·19·20 가상 일지(실제 업무 기록 아님). docs/v2-design/84
import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { DatabaseSync } from "node:sqlite";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { prepareCopy, LIMITS } from "../../src/preview/migrationEngine";
import { createCopyCore } from "../../poc/v2-assets/copy-core.mjs";
import { createWorkspaceMapper } from "../../poc/v2-migration/workspace-map-core.mjs";
// @ts-expect-error PoC Node 모듈(형식 선언 없음)
import { buildSourceFixture } from "../../poc/v2-migration/source-fixture.mjs";
// @ts-expect-error PoC Node 모듈
import { createWorkspaceDB } from "../../poc/v2-sync/db18.mjs";
// @ts-expect-error PoC Node 모듈
import { hash as nodeHash } from "../../poc/v2-sync/model.mjs";
// @ts-expect-error PoC Node 모듈
import { createConnectedCopy } from "../../poc/v2-assets/connected-copy.mjs";
// @ts-expect-error PoC Node 모듈
import { mapWorkspace } from "../../poc/v2-migration/workspace-map.mjs";
import { SECTION_ICONS } from "../../src/shared/sectionIcons";

let SQL: SqlJsStatic;
let dir: string;
beforeAll(async () => {
  SQL = await initSqlJs();
  dir = mkdtempSync(join(tmpdir(), "wjb-c3-"));
  return () => rmSync(dir, { recursive: true, force: true });
});
const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
function source(version: number, extra = 0) {
  const d = join(dir, `src-${version}-${extra}-${randomUUID()}`);
  mkdirSync(d);
  writeFileSync(join(d, ".v2-poc-only"), "synthetic");
  const file = join(d, "source.db");
  buildSourceFixture(file, version, extra);
  return { file, bytes: new Uint8Array(readFileSync(file)) };
}
const WS = "11111111-1111-4111-8111-111111111111";
const SRC = "22222222-2222-4222-8222-222222222222";

/** Node 기준: node:sqlite 읽기 + node:crypto 해시 + Buffer base64, 같은 순수 핵심 */
function nodeReference(file: string, randomUUIDFn: () => string) {
  const core = createCopyCore({
    hash: nodeHash,
    randomUUID: randomUUIDFn,
    base64ToBytes: (s) => Buffer.from(s, "base64"),
    bytesToBase64: (b) => Buffer.from(b).toString("base64"),
  });
  const db = new DatabaseSync(file, { readOnly: true });
  let rows;
  try {
    rows = core.captureRows(db as never, {
      allowNoteImages: true,
      expectedSchema(v) {
        const e = createWorkspaceDB(":memory:", v);
        try {
          return core.schemaModel(e);
        } finally {
          e.close();
        }
      },
    });
  } finally {
    db.close();
  }
  const copy = core.extractCopy(
    { sourceHash: nodeHash(readFileSync(file)), rows },
    { workspaceId: WS, sourceWorkspaceId: SRC },
  );
  return createWorkspaceMapper({
    hash: nodeHash,
    sectionIconIds: new Set(SECTION_ICONS.map((i) => i.id)),
  }).mapCopy(copy, WS);
}

describe("C-3 이관 엔진 = PoC Node 경로", () => {
  for (const version of [18, 19, 20])
    it(`DB${version}: 봉투·해시가 바이트 단위로 같다`, () => {
      const { file, bytes } = source(version);
      const app = prepareCopy(SQL, bytes, { workspaceId: WS, sourceWorkspaceId: SRC, randomUUID: seq() });
      const ref = nodeReference(file, seq());
      expect(app.mappingHash).toBe(ref.mappingHash);
      const { records, ...header } = ref.envelope;
      expect(app.header).toEqual(header);
      expect(app.pages.flat()).toEqual(records);
      expect(app.sourceHash).toBe(nodeHash(readFileSync(file)));
      // 그림: 바이트 해시·크기 = 봉투 목록, 봉투·페이지에는 그림 본문 없음
      expect(app.assets.length).toBeGreaterThan(0);
      for (const a of app.assets) {
        const b = app.assetBytes.get(a.objectId)!;
        expect(nodeHash(Buffer.from(b))).toBe(a.sha256);
        expect(b.length).toBe(a.bytes);
      }
      expect(JSON.stringify(app.pages)).not.toMatch(/data\s*:\s*image\//i);
      // 원본 사본 바이트는 그대로
      expect(Buffer.from(bytes).equals(readFileSync(file))).toBe(true);
    });

  it("PoC 전체 경로(사본 폴더 → 봉투)와 객체 ID만 다르고 같다", () => {
    const { file, bytes } = source(20);
    const d = join(dir, `copy-${randomUUID()}`);
    mkdirSync(d);
    writeFileSync(join(d, ".v2-poc-only"), "synthetic");
    createConnectedCopy(file, join(d, "copy"), { workspaceId: WS, sourceWorkspaceId: SRC });
    const ref = mapWorkspace(join(d, "copy"), WS).envelope;
    const app = prepareCopy(SQL, bytes, { workspaceId: WS, sourceWorkspaceId: SRC });
    const norm = (v: unknown) => {
      const sha = new Map<string, string>();
      for (const a of [...(v as { assets: { objectId: string; sha256: string }[] }).assets].sort((x, y) =>
        x.sha256 < y.sha256 ? -1 : 1,
      ))
        sha.set(a.objectId, a.sha256);
      return JSON.parse(
        JSON.stringify(v).replace(
          /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g,
          (m) => (sha.has(m) ? `obj:${sha.get(m)}` : m),
        ),
      );
    };
    const strip = (e: Record<string, unknown>) => {
      // 원본 manifest 해시는 객체 ID를 담아 서로 다르다 — 나머지를 비교
      const rest = { ...e };
      delete rest.sourceManifestHash;
      const assets = rest.assets;
      return { ...rest, assets: (assets as { sha256: string }[]).map((a) => a.sha256).sort() };
    };
    const a = norm({ ...app.header, records: app.pages.flat() });
    const r = norm(ref);
    a.records.sort((x: { table: string; key: string }, y: { table: string; key: string }) =>
      x.table + x.key < y.table + y.key ? -1 : 1,
    );
    r.records.sort((x: { table: string; key: string }, y: { table: string; key: string }) =>
      x.table + x.key < y.table + y.key ? -1 : 1,
    );
    expect(strip(a)).toEqual(strip(r));
  });

  it("큰 일지: 1,000행·크기 예산으로 나눈다(서버 013 D-a), 순서 그대로", () => {
    const { bytes } = source(20, 5000);
    const app = prepareCopy(SQL, bytes, { workspaceId: WS, sourceWorkspaceId: SRC, randomUUID: seq() });
    expect(app.recordsTotal).toBeGreaterThan(5000);
    expect(app.pages.every((p) => p.length <= 1000)).toBe(true);
    expect(app.pages.length).toBe(Math.ceil(app.recordsTotal / 1000));
    const small = prepareCopy(SQL, bytes, {
      workspaceId: WS,
      sourceWorkspaceId: SRC,
      randomUUID: seq(),
      pageBytes: 200_000,
    });
    expect(small.pages.length).toBeGreaterThan(app.pages.length);
    expect(small.pages.length).toBeLessThanOrEqual(LIMITS.pages);
    for (const p of small.pages)
      expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThanOrEqual(200_000);
    expect(small.pages.flat()).toEqual(app.pages.flat());
    expect(() =>
      prepareCopy(SQL, bytes, { workspaceId: WS, sourceWorkspaceId: SRC, pageBytes: 300 }),
    ).toThrow(/RECORD_TOO_LARGE|COPY_TOO_LARGE/);
  });

  it("거절: 쓰는 중(칸반 쓰기 중단)·구조가 다른 일지·망가진 파일", () => {
    const { file } = source(20);
    const broken = new DatabaseSync(file);
    broken.exec("UPDATE kanban_ctx SET source='bulk'");
    broken.close();
    expect(() =>
      prepareCopy(SQL, new Uint8Array(readFileSync(file)), { workspaceId: WS, sourceWorkspaceId: SRC }),
    ).toThrow("KANBAN_WRITE_IN_PROGRESS");
    const other = source(20);
    const db = new DatabaseSync(other.file);
    db.exec("CREATE TABLE extra_local(x)");
    db.close();
    expect(() =>
      prepareCopy(SQL, new Uint8Array(readFileSync(other.file)), { workspaceId: WS, sourceWorkspaceId: SRC }),
    ).toThrow("SCHEMA_UNSUPPORTED");
    expect(() =>
      prepareCopy(SQL, new Uint8Array(4096), { workspaceId: WS, sourceWorkspaceId: SRC }),
    ).toThrow();
  });
});
