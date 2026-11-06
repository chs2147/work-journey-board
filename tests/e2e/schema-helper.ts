import { readdirSync } from "node:fs";
export const CURRENT_SCHEMA = Math.max(
  ...readdirSync("src/data/migrations").map((f) => Number(f.slice(0, 4))),
);
