// 코칭 예시 일지 만들기(coaching-spec 4-5, D11) — 메모리(sql.js) 일지에 가상 샘플을 이번 주로 옮겨 넣는다. 파일·백업·설정 없음.
import type { SqlDriver } from "../../data/driver";
import { SqlJsDriver } from "../../data/drivers/sqlJs";
import { migrate } from "../../data/migrate";
import { seedSample, type SampleData } from "../../data/seed";
import { sampleWeekShift, shiftSampleDates } from "../../domain/coachingSample";
import { loadSql } from "../../preview/migrationSession";

export async function makeCoachingSample(now: Date): Promise<SqlDriver> {
  const [SQL, data] = await Promise.all([loadSql(), import("../../../fixtures/sample-showcase.json")]);
  const driver = new SqlJsDriver(new SQL.Database(), "코칭 예시 일지(메모리)");
  await migrate(driver, { now: () => now });
  await seedSample(driver, shiftSampleDates(data.default as SampleData, sampleWeekShift(now)), now);
  return driver;
}
