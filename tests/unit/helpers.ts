import { prepareConnection } from "../../src/data/driver";
import { openSqlJsMemory } from "../../src/data/drivers/sqlJs";
import { migrate } from "../../src/data/migrate";
import { JournalRepository } from "../../src/data/repository";

/** 로컬 시각 기준 고정 시계 */
export function clockAt(y: number, m: number, d: number, h = 9, min = 0) {
  let t = new Date(y, m - 1, d, h, min);
  return {
    now: () => new Date(t),
    set: (y2: number, m2: number, d2: number, h2 = 9, min2 = 0) => {
      t = new Date(y2, m2 - 1, d2, h2, min2);
    },
  };
}

export async function freshRepo(clock = clockAt(2026, 10, 23)) {
  const db = await openSqlJsMemory();
  await prepareConnection(db);
  await migrate(db, { now: clock.now });
  return { db, repo: new JournalRepository(db, clock.now), clock };
}
