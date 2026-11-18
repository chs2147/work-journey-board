// G-7(docs/v2-design/101) 관리자 내보내기 — 온라인 공간 전부를 앱의 이 기기 사본과 같은 형식으로 내려받는다(서버는 읽기만).
//   <출력>/<공간>/header.json · records.json · <sha256>.bin  +  <출력>/export-manifest.json(공간·행·그림 수, 파일 SHA-256)
// 이 형식은 앱의 되살리기(restoreFromCache)가 그대로 읽는다 → 서버 없이도 로컬 일지(.db)로 되살릴 수 있다(restore 시험).
// 명시 실행만: `node poc/v2-ops/export.mjs --export-development <출력 폴더>` · 운영 `--export-production <출력 폴더>`
// (WJB_CLOUD_ENV=production, 서버는 읽기만이라 --production-confirmed 없음 — 대상 고르기는 target.mjs 한 곳).
// 관리 토큰은 읽기 전용 SQL에만, 서버 열쇠는 그림 내려받기에만 쓰고 어디에도 쓰지 않는다. 출력은 저장소 밖(.gitignore exports/).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { serverKeyHeaders } from "../v2-gateway/io.mjs";
import { opsTarget } from "./target.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function exportTarget(argv, env) {
  const t = opsTarget(argv, env, { action: "export", args: 1, needs: ["management", "serverKey"] });
  const dir = resolve(t.args[0]);
  if (existsSync(dir) && readdirSync(dir).length) throw Error("OUTPUT_NOT_EMPTY");
  return {
    name: t.environment,
    ref: t.ref,
    bucket: t.bucket,
    mgmt: t.managementToken,
    key: t.serverKey,
    dir,
  };
}

/** 한 공간의 내보내기 묶음(순수 — 시험): 동기화한 공간은 지금 기록(지움 표시 뺌), 아니면 게시본. 그림 = 기록이 참조하는 것만 */
export function buildSpace({ job, header, records, assets }) {
  const refs = new Set();
  for (const r of records)
    for (const f of ["dataRef", "thumbRef"]) {
      const id = r.value?.[f]?.objectId;
      if (typeof id === "string" && uuid.test(id)) refs.add(id);
    }
  const byId = new Map(assets.map((a) => [a.objectId, a]));
  const missing = [...refs].filter((id) => !byId.has(id));
  if (missing.length) throw Error("EXPORT_ASSET_MISSING");
  const used = [...refs].sort().map((id) => byId.get(id));
  return {
    header: {
      workspaceId: job.workspace_id,
      manifestHash: job.manifest_hash,
      createdAt: job.created_at ?? null,
      header,
      assets: used.map((a) => ({ objectId: a.objectId, sha256: a.sha256, bytes: Number(a.bytes) })),
    },
    records: records.map((r) => ({ table: r.table, key: r.key, value: r.value })),
  };
}

async function main() {
  const t = exportTarget(process.argv.slice(2), process.env);
  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${t.ref}/database/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${t.mgmt}`, "content-type": "application/json" },
      body: JSON.stringify({ query: "SET TRANSACTION READ ONLY;\n" + query, read_only: false }),
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw Error("SQL_" + r.status);
    return r.json();
  };
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  mkdirSync(t.dir, { recursive: true });
  const jobs = await sql(
    "SELECT j.id,j.workspace_id,j.owner_id,j.manifest_hash,h.value header,(SELECT EXISTS(SELECT 1 FROM wjb_sync.space s WHERE s.workspace_id=j.workspace_id)) synced FROM wjb_migration.job j JOIN wjb_migration.workspace_header h ON h.job_id=j.id WHERE j.state='connected' AND j.profile<>'migration-document-poc-1' ORDER BY j.workspace_id;",
  );
  const manifest = {
    exportedAt: new Date().toISOString(),
    environment: t.name,
    spaces: [],
    productionTouched: t.name === "production",
  };
  for (const j of jobs) {
    if (!uuid.test(j.workspace_id)) throw Error("BAD_ID");
    const records = j.synced
      ? await sql(
          `SELECT table_name AS "table",record_key AS key,value FROM wjb_sync.record WHERE workspace_id='${j.workspace_id}' AND value IS NOT NULL ORDER BY table_name,record_key;`,
        )
      : await sql(
          `SELECT table_name AS "table",record_key AS key,value FROM wjb_migration.workspace_record WHERE job_id='${j.id}' ORDER BY table_name,record_key;`,
        );
    const assets = await sql(
      `SELECT id::text AS "objectId",sha256,bytes FROM wjb_gateway.asset WHERE workspace_id='${j.workspace_id}' AND state='ready';`,
    );
    const space = buildSpace({ job: j, header: j.header, records, assets });
    const dir = join(t.dir, j.workspace_id);
    mkdirSync(dir);
    const files = {};
    const put = (name, bytes) => {
      writeFileSync(join(dir, name), bytes);
      files[name] = sha(bytes);
    };
    put("header.json", Buffer.from(JSON.stringify(space.header)));
    put("records.json", Buffer.from(JSON.stringify(space.records)));
    for (const a of space.header.assets) {
      const r = await fetch(
        `https://${t.ref}.supabase.co/storage/v1/object/authenticated/${t.bucket}/${j.workspace_id}/${a.objectId}`,
        { headers: serverKeyHeaders(t.key), redirect: "error", signal: AbortSignal.timeout(60000) },
      );
      if (!r.ok) throw Error("ASSET_HTTP_" + r.status);
      const b = Buffer.from(await r.arrayBuffer());
      if (sha(b) !== a.sha256 || b.length !== a.bytes) throw Error("ASSET_INTEGRITY");
      if (!files[`${a.sha256}.bin`]) put(`${a.sha256}.bin`, b);
    }
    manifest.spaces.push({
      workspaceId: j.workspace_id,
      ownerId: j.owner_id,
      synced: j.synced,
      sourceSchema: j.header?.sourceSchema ?? null,
      records: space.records.length,
      assets: space.header.assets.length,
      assetBytes: space.header.assets.reduce((n, a) => n + a.bytes, 0),
      files,
    });
  }
  writeFileSync(join(t.dir, "export-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    JSON.stringify({
      spaces: manifest.spaces.length,
      records: manifest.spaces.reduce((n, s) => n + s.records, 0),
      assets: manifest.spaces.reduce((n, s) => n + s.assets, 0),
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
