// main Pages 게시 직전 Cabi.NET 검증판 표시만 제거한다. 작업 브랜치 원본은 유지한다.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const rootArg = process.argv.indexOf("--root");
const root = rootArg >= 0 ? process.argv[rootArg + 1] : "site";
if (!root) throw new Error("--root 폴더를 지정해 주세요.");
const file = resolve(root, "index.html");
const source = readFileSync(file, "utf8");
const preview = /<span\b[^>]*\bdata-cabi-preview[^>]*>[^<]*<\/span>/g;
const count = [...source.matchAll(preview)].length;
if (count !== 0 && count !== 3) throw new Error(`Cabi.NET 검증판 표시가 예상한 3곳과 다릅니다: ${count}`);
const result = source.replace(preview, "");
if (result.includes("data-cabi-preview")) throw new Error("제거하지 못한 Cabi.NET 검증판 표시가 있습니다.");
writeFileSync(file, result);
console.log(`Cabi.NET 검증판 표시 ${count}곳 제거: main 게시 준비 완료`);
