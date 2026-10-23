import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { openSqlJsMemory } from "../data/drivers/sqlJs";
import type { Platform } from "./index";

// 브라우저 모드: 메모리 DB(새로고침하면 사라짐). 가상 샘플 시드는 S2에서 스키마와 함께 연결한다.
export const browserPlatform: Platform = {
  kind: "browser",
  openJournal: () => openSqlJsMemory(wasmUrl),
};
