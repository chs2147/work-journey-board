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
