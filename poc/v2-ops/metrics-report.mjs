// G-6(docs/v2-design/102) 측정 요약 — wjb_ops.metric_day(하루 한 줄, 합계만)를 읽기만 해서 기간 요약과 안전선까지 남은 날을 계산.
//   node poc/v2-ops/metrics-report.mjs --report-development [일수(기본 14)]
// 내보내기(egress)·Edge 호출 수는 SQL에 없다 → 대시보드 Usage 값과 함께 102문서 측정 기록에 적는다.
const ref = "vsphftnmfzfoufasjttd";

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

async function main() {
  const [flag, d = "14"] = process.argv.slice(2);
  if (
    flag !== "--report-development" ||
    process.env.WJB_CLOUD_ENV !== "development" ||
    process.env.WJB_SUPABASE_DEV_PROJECT_REF !== ref
  )
    throw Error("EXPLICIT_REPORT_REQUIRED");
  const days = Number(d);
  if (!Number.isInteger(days) || days < 1 || days > 120) throw Error("BAD_DAYS");
  const token = process.env.WJB_SUPABASE_DEV_MANAGEMENT_TOKEN;
  if (!token) throw Error("CREDENTIALS_REQUIRED");
  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query: "SET TRANSACTION READ ONLY; " + query, read_only: false }),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw Error("SQL_" + r.status);
    return r.json();
  };
  const rows = await sql(`SELECT * FROM wjb_ops.metric_day WHERE day>current_date-${days} ORDER BY day;`);
  const [lim] = await sql(
    "SELECT (SELECT value FROM wjb_ops.setting WHERE key='project_db') db,(SELECT value FROM wjb_ops.setting WHERE key='project_images') images;",
  );
  console.log(
    JSON.stringify(summarize(rows, { dbLimit: Number(lim.db), imagesLimit: Number(lim.images) }), null, 2),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
