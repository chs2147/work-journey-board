// G-6(docs/v2-design/102) 측정 요약 — wjb_ops.metric_day(하루 한 줄, 합계만)를 읽기만 해서 기간 요약과 안전선까지 남은 날을 계산.
//   node poc/v2-ops/metrics-report.mjs --report-development [일수(기본 14)]
//   node poc/v2-ops/metrics-report.mjs --report-production [일수]   (WJB_CLOUD_ENV=production — 읽기만이라 확인 플래그 없음)
// 대상 고르기는 target.mjs 한 곳(개발·운영 안 섞임). 관리 토큰은 읽기 전용 SQL에만, 출력·파일에 남기지 않는다.
// 내보내기(egress)·Edge 호출 수는 SQL에 없다 → 대시보드 Usage 값과 함께 102문서 측정 기록에 적는다.
// 105문서 관문 D: 안전선까지 남은 날 180일 이상(증가가 없으면 통과로 본다), 측정 14일 이상.
import { managementSql, opsTarget } from "./target.mjs";

export const GATE_D = Object.freeze({ minDays: 14, minDaysToLine: 180 });

/** 순수 요약(시험): 하루 평균 변경·보내기·기기, DB·그림 하루 증가, 안전선까지 남은 날(증가가 없으면 null) */
export function summarize(rows, { dbLimit = 419430400, imagesLimit = 838860800 } = {}) {
  const r = [...rows].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  if (!r.length) return { days: 0 };
  const n = r.length;
  const avg = (k) => Math.round((r.reduce((s, x) => s + Number(x[k]), 0) / n) * 10) / 10;
  const first = r[0],
    last = r[n - 1];
  const span = Math.max(1, n - 1);
  const perDay = (k) => (Number(last[k]) - Number(first[k])) / span;
  const left = (k, lim) => {
    const g = perDay(k);
    return g > 0 ? Math.floor((lim - Number(last[k])) / g) : null;
  };
  return {
    days: n,
    from: String(first.day).slice(0, 10),
    to: String(last.day).slice(0, 10),
    avgChangesPerDay: avg("changes_day"),
    avgPushesPerDay: avg("pushes_day"),
    avgDevicesPerDay: avg("devices_day"),
    dbBytesPerDay: Math.round(perDay("db_bytes")),
    imageBytesPerDay: Math.round(perDay("image_bytes")),
    daysToDbLine: left("db_bytes", dbLimit),
    daysToImagesLine: left("image_bytes", imagesLimit),
    tombstones: Number(last.tombstones),
    records: Number(last.records),
    imagesReleased: Number(last.images_released),
  };
}

/** 105 관문 D 중 SQL로 볼 수 있는 부분(무료 플랜 사용률은 대시보드 Usage로 따로) */
export function gateD(summary, g = GATE_D) {
  const lineOk = (d) => d === null || d === undefined || d >= g.minDaysToLine;
  const enoughDays = (summary.days ?? 0) >= g.minDays;
  const toLines = lineOk(summary.daysToDbLine) && lineOk(summary.daysToImagesLine);
  return { enoughDays, toLines, pass: enoughDays && toLines };
}

async function main() {
  const argv = process.argv.slice(2);
  const t = opsTarget(argv, process.env, { action: "report", args: argv.length > 1 ? 1 : 0 });
  const days = Number(t.args[0] ?? "14");
  if (!Number.isInteger(days) || days < 1 || days > 120) throw Error("BAD_DAYS");
  const run = managementSql(t);
  const sql = (query) => run(query, true);
  const rows = await sql(`SELECT * FROM wjb_ops.metric_day WHERE day>current_date-${days} ORDER BY day;`);
  const [lim] = await sql(
    "SELECT (SELECT value FROM wjb_ops.setting WHERE key='project_db') db,(SELECT value FROM wjb_ops.setting WHERE key='project_images') images;",
  );
  const summary = summarize(rows, { dbLimit: Number(lim.db), imagesLimit: Number(lim.images) });
  console.log(JSON.stringify({ environment: t.environment, ...summary, gateD: gateD(summary) }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
