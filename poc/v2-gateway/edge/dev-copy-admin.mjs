// 개발 프로젝트 전용: C-5 실기 뒤 온라인 사본 자료 확인·지우기(docs/v2-design/86).
// - 보고(--report-development): 계정(앞 8자리)별 작업·공간·기록·그림·저장소 객체 **개수만**. 기록 내용·그림은 읽지 않는다.
// - 지우기(--purge-owner-development <계정 ID> --confirm): 그 계정의 이관 작업·업로드·기록·온라인 공간·그림 메타·저장소 객체.
//   로그인 계정(auth)·기기 등록은 남긴다. 로컬 일지와 무관(서버 자료만).
import { serverKeyHeaders } from "../io.mjs";
const ref = "vsphftnmfzfoufasjttd",
  bucket = "wjb-v2-dev-assets";
const args = process.argv.slice(2);
const report = args.join(" ") === "--report-development";
const purge =
  args.length === 3 &&
  args[0] === "--purge-owner-development" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(args[1]) &&
  args[2] === "--confirm";
if (
  (!report && !purge) ||
  process.env.WJB_CLOUD_ENV !== "development" ||
  process.env.WJB_SUPABASE_DEV_PROJECT_REF !== ref
)
  throw Error("EXPLICIT_DEV_RUN_REQUIRED");
const mgmt = process.env.WJB_SUPABASE_DEV_MANAGEMENT_TOKEN,
  key = process.env.WJB_SUPABASE_DEV_SERVICE_ROLE_KEY;
if (!mgmt || !key) throw Error("DEV_CREDENTIALS_REQUIRED");
const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${mgmt}`, "content-type": "application/json" },
    body: JSON.stringify({ query, read_only: false }),
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw Error("DEV_SQL_" + r.status);
  return r.json();
};
const counts = () =>
  sql(`SELECT left(o::text,8) AS owner,
  (SELECT count(*) FROM wjb_migration.job j WHERE j.owner_id=o) jobs,
  (SELECT count(*) FROM wjb_migration.job j WHERE j.owner_id=o AND j.state='connected') published,
  (SELECT count(*) FROM wjb_migration.upload u WHERE u.owner_id=o) uploads,
  (SELECT count(*) FROM wjb_migration.workspace_record r JOIN wjb_migration.job j ON j.id=r.job_id WHERE j.owner_id=o) records,
  (SELECT count(*) FROM wjb_gateway.workspace w WHERE w.owner_id=o) workspaces,
  (SELECT count(*) FROM wjb_gateway.asset a JOIN wjb_gateway.workspace w ON w.id=a.workspace_id WHERE w.owner_id=o) assets,
  (SELECT coalesce(sum(w.used_bytes),0) FROM wjb_gateway.workspace w WHERE w.owner_id=o) used_bytes,
  (SELECT count(*) FROM storage.objects s WHERE s.bucket_id='${bucket}' AND split_part(s.name,'/',1) IN (SELECT w.id::text FROM wjb_gateway.workspace w WHERE w.owner_id=o)) objects
  FROM (SELECT owner_id o FROM wjb_migration.job UNION SELECT owner_id FROM wjb_migration.upload UNION SELECT owner_id FROM wjb_gateway.workspace) x ORDER BY 1;`);
if (report) {
  console.log(JSON.stringify({ projectRef: ref, productionTouched: false, owners: await counts() }, null, 2));
} else {
  const owner = args[1];
  const ws = (await sql(`SELECT id FROM wjb_gateway.workspace WHERE owner_id='${owner}';`)).map((r) => r.id);
  for (const w of ws) {
    for (;;) {
      const list = await fetch(`https://${ref}.supabase.co/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: { ...serverKeyHeaders(key), "content-type": "application/json" },
        body: JSON.stringify({ prefix: w, limit: 1000 }),
      }).then((r) => r.json());
      const names = (list ?? []).map((o) => `${w}/${o.name}`);
      if (!names.length) break;
      await fetch(`https://${ref}.supabase.co/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: { ...serverKeyHeaders(key), "content-type": "application/json" },
        body: JSON.stringify({ prefixes: names }),
      });
    }
  }
  await sql(`BEGIN;
DO $s$ BEGIN IF to_regnamespace('wjb_sync') IS NOT NULL THEN
 DELETE FROM wjb_sync.applied WHERE workspace_id IN (SELECT workspace_id FROM wjb_sync.space WHERE owner_id='${owner}');
 DELETE FROM wjb_sync.asset_declared WHERE workspace_id IN (SELECT workspace_id FROM wjb_sync.space WHERE owner_id='${owner}');
 DELETE FROM wjb_sync.record WHERE workspace_id IN (SELECT workspace_id FROM wjb_sync.space WHERE owner_id='${owner}');
 DELETE FROM wjb_sync.space WHERE owner_id='${owner}';
END IF; END $s$;
DELETE FROM wjb_migration.upload WHERE owner_id='${owner}';
DELETE FROM wjb_migration.workspace_record WHERE job_id IN (SELECT id FROM wjb_migration.job WHERE owner_id='${owner}');
DELETE FROM wjb_migration.workspace_header WHERE job_id IN (SELECT id FROM wjb_migration.job WHERE owner_id='${owner}');
DELETE FROM wjb_migration.document WHERE job_id IN (SELECT id FROM wjb_migration.job WHERE owner_id='${owner}');
DELETE FROM wjb_migration.asset WHERE job_id IN (SELECT id FROM wjb_migration.job WHERE owner_id='${owner}');
DELETE FROM wjb_migration.job WHERE owner_id='${owner}';
DELETE FROM wjb_gateway.recovery_audit WHERE workspace_id IN (SELECT id FROM wjb_gateway.workspace WHERE owner_id='${owner}');
DELETE FROM wjb_gateway.io_intent WHERE workspace_id IN (SELECT id FROM wjb_gateway.workspace WHERE owner_id='${owner}');
DELETE FROM wjb_gateway.asset WHERE workspace_id IN (SELECT id FROM wjb_gateway.workspace WHERE owner_id='${owner}');
DELETE FROM wjb_gateway.workspace WHERE owner_id='${owner}';
COMMIT;`);
  const left = (await counts()).find((r) => r.owner === owner.slice(0, 8)) ?? null;
  console.log(
    JSON.stringify({ projectRef: ref, purgedOwner: owner.slice(0, 8), workspaces: ws.length, left }, null, 2),
  );
}
