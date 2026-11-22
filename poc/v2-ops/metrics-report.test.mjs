import test from "node:test";
import assert from "node:assert/strict";
import { summarize } from "./metrics-report.mjs";

const row = (day, db, img, ch) => ({
  day,
  db_bytes: db,
  image_bytes: img,
  changes_day: ch,
  pushes_day: ch / 2,
  devices_day: 2,
  tombstones: 5,
  records: 100,
  images_released: 1,
});

test("G-6 요약: 하루 평균·하루 증가·안전선까지 남은 날", () => {
  const s = summarize(
    [
      row("2026-11-03", 100e6, 50e6, 40),
      row("2026-11-01", 80e6, 40e6, 20),
      row("2026-11-02", 90e6, 45e6, 30),
    ],
    { dbLimit: 400e6, imagesLimit: 800e6 },
  );
  assert.equal(s.days, 3);
  assert.equal(s.from, "2026-11-01");
  assert.equal(s.avgChangesPerDay, 30);
  assert.equal(s.dbBytesPerDay, 10e6);
  assert.equal(s.daysToDbLine, 30);
  assert.equal(s.daysToImagesLine, 150);
});

test("G-6 요약: 늘지 않으면 남은 날 없음, 줄이 없으면 days 0", () => {
  const s = summarize([row("2026-11-01", 80e6, 40e6, 0), row("2026-11-02", 80e6, 39e6, 0)]);
  assert.equal(s.daysToDbLine, null);
  assert.equal(s.daysToImagesLine, null);
  assert.deepEqual(summarize([]), { days: 0 });
});

test("105 관문 D: 14일 이상 측정 + 안전선까지 180일 이상(증가 없음 = 통과)", async () => {
  const { gateD } = await import("./metrics-report.mjs");
  assert.deepEqual(gateD({ days: 14, daysToDbLine: 400, daysToImagesLine: null }), {
    enoughDays: true,
    toLines: true,
    pass: true,
  });
  assert.equal(gateD({ days: 7, daysToDbLine: null, daysToImagesLine: null }).pass, false);
  assert.equal(gateD({ days: 20, daysToDbLine: 179, daysToImagesLine: 900 }).toLines, false);
  assert.equal(gateD({ days: 0 }).enoughDays, false);
});
