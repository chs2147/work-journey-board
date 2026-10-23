import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import sample from "../../fixtures/sample-weeks.json";
import { prepareConnection } from "../data/driver";
import { openSqlJsMemory } from "../data/drivers/sqlJs";
import { migrate } from "../data/migrate";
import { seedSample } from "../data/seed";
import type { Platform } from "./index";

// 브라우저 모드: 메모리 DB + 가상 샘플(새로고침하면 처음 상태로 돌아간다).
// 테스트·시연용 주소 옵션: ?today=YYYY-MM-DD (오늘 날짜 고정), ?empty=1 (샘플 없이 빈 일지)
const params = new URLSearchParams(globalThis.location?.search ?? "");
const fixedToday = /^\d{4}-\d{2}-\d{2}$/.test(params.get("today") ?? "") ? params.get("today")! : null;

export const browserPlatform: Platform = {
  kind: "browser",
  async openJournal() {
    const driver = await openSqlJsMemory(wasmUrl);
    await prepareConnection(driver);
    await migrate(driver);
    if (params.get("empty") !== "1") await seedSample(driver, sample);
    return driver;
  },
  now() {
    const real = new Date();
    if (!fixedToday) return real;
    const [y, m, d] = fixedToday.split("-").map(Number);
    return new Date(y!, m! - 1, d!, real.getHours(), real.getMinutes(), real.getSeconds());
  },
};
