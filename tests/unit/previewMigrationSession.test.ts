// @vitest-environment node
// C-4: 브라우저 모드 가짜 원본(앱 마이그레이션 + 가상 샘플)이 이관 엔진을 통과하고, 같은 작업 ID면 같은 자료가 나오는지
import { describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import { migrate } from "../../src/data/migrate";
import { openSqlJs } from "../../src/data/drivers/sqlJs";
import { seedSample } from "../../src/data/seed";
import sample from "../../fixtures/sample-showcase.json";
import { prepareCopy } from "../../src/preview/migrationEngine";
import { derivedId, summarize } from "../../src/preview/migrationSession";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: "" }));

describe("C-4 준비", () => {
  it("앱이 만든 일지(제품 마이그레이션 + 가상 샘플) → 이관 자료, 작업 ID가 같으면 mappingHash 같음", async () => {
    const d = await openSqlJs();
    await migrate(d);
    await seedSample(d, sample as never);
    const bytes = d.exportBytes();
    const SQL = await initSqlJs();
    const job = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const make = () => {
      let n = 0;
      return prepareCopy(SQL, bytes, {
        workspaceId: derivedId(job, "workspace"),
        sourceWorkspaceId: derivedId(job, "source"),
        randomUUID: () => derivedId(job, `object-${++n}`),
      });
    };
    const a = make(),
      b = make();
    expect(a.mappingHash).toBe(b.mappingHash);
    const s = summarize(a);
    expect(s.sourceSchema).toBe(20);
    expect(s.entries).toBeGreaterThan(10);
    expect(s.images).toBeGreaterThan(0);
    expect(derivedId(job, "workspace")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(derivedId(job, "workspace")).not.toBe(
      derivedId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "workspace"),
    );
  });
});

describe("C-5: 구조 비교는 의미로(오래 쓴 일지의 표 정의 글자 차이 허용), 다르면 다른 곳 이름", () => {
  async function journal() {
    const d = await openSqlJs();
    await migrate(d);
    await seedSample(d, sample as never);
    return d.exportBytes();
  }
  const ids = (job: string) => {
    let n = 0;
    return {
      workspaceId: derivedId(job, "workspace"),
      sourceWorkspaceId: derivedId(job, "source"),
      randomUUID: () => derivedId(job, `object-${++n}`),
    };
  };
  const job = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  it("표 정의 글자의 공백·따옴표·줄바꿈이 달라도(ALTER를 거친 일지) 통과", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database(await journal());
    const row = db.exec("SELECT sql FROM sqlite_master WHERE name='category'")[0]!.values[0]![0] as string;
    const reformatted = row.replace(/\s+/g, "  ").replace("category", '"category"').replace(/,/g, " ,\n ");
    db.run("PRAGMA writable_schema=ON");
    db.run("UPDATE sqlite_master SET sql=? WHERE name='category'", [reformatted]);
    db.run("PRAGMA writable_schema=OFF");
    const bytes = db.export();
    expect(
      new SQL.Database(bytes).exec("SELECT sql FROM sqlite_master WHERE name='category'")[0]!.values[0]![0],
    ).not.toBe(row);
    expect(() => prepareCopy(SQL, bytes, ids(job))).not.toThrow();
  });

  it("윈도우에서 빌드된 앱이 올린 구조(정의 줄 끝 \\r\\n — C-5 맥 실기 원인)도 통과", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database(await journal());
    db.run("PRAGMA writable_schema=ON");
    db.run(
      "UPDATE sqlite_master SET sql=replace(sql, char(10), char(13)||char(10)) WHERE name IN ('kanban_ctx','kanban_section','item_status_log','kanban_bulk','entry_item_status_log')",
    );
    db.run("PRAGMA writable_schema=OFF");
    const bytes = db.export();
    const crlf = new SQL.Database(bytes).exec("SELECT sql FROM sqlite_master WHERE name='kanban_ctx'")[0]!
      .values[0]![0];
    expect(String(crlf)).toContain("\r\n");
    expect(() => prepareCopy(SQL, bytes, ids(job))).not.toThrow();
  });

  it("열이 더 있거나 색인이 없으면 거절 + 다른 곳 이름(내용 없음)", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database(await journal());
    db.run("ALTER TABLE category ADD COLUMN legacy_note TEXT");
    const idx = db.exec(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' LIMIT 1",
    )[0]!.values[0]![0] as string;
    db.run(`DROP INDEX "${idx}"`);
    let err: (Error & { details?: string[] }) | null = null;
    try {
      prepareCopy(SQL, db.export(), ids(job));
    } catch (e) {
      err = e as Error & { details?: string[] };
    }
    expect(err?.message).toBe("SCHEMA_UNSUPPORTED");
    expect(err?.details).toEqual(
      expect.arrayContaining(["table:category 열 legacy_note 더 있음", `index:${idx} 없음`]),
    );
  });
});
