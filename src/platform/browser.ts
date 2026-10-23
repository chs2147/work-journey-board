import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import sample from "../../fixtures/sample-weeks.json";
import { prepareConnection } from "../data/driver";
import { openSqlJsMemory } from "../data/drivers/sqlJs";
import { migrate } from "../data/migrate";
import { seedSample } from "../data/seed";
import type { Platform } from "./index";

// 브라우저 모드: 메모리 DB + 가상 샘플(새로고침하면 처음 상태로 돌아간다).
export const browserPlatform: Platform = {
  kind: "browser",
  async openJournal() {
    const driver = await openSqlJsMemory(wasmUrl);
    await prepareConnection(driver);
    await migrate(driver);
    await seedSample(driver, sample);
    return driver;
  },
};
