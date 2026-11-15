// @vitest-environment node
// C-3 실서버 확인(개발 프로젝트만, 명시 실행 WJB_LIVE_C3=1) — 앱의 이관 엔진·실행기를 그대로 쓰고,
// 통신만 Rust migration.rs와 같은 경로·본문의 Node HTTP로 대신한다. 가상 일지·시험 계정만, 끝나면 모두 지운다.
// 평소 npm test에서는 건너뛴다. 증거: docs/v2-design/evidence/preview-dev-c3-engine-live.json
import { describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import type { MigrationJournal, PreviewMigration } from "../../src/platform";
import { prepareCopy } from "../../src/preview/migrationEngine";
import { canonical } from "../../poc/v2-sync/hash-core.mjs";
import { cancelMigration, runMigration } from "../../src/preview/migrationRunner";
// @ts-expect-error PoC Node 모듈
import { buildSourceFixture } from "../../poc/v2-migration/source-fixture.mjs";

const REF = "vsphftnmfzfoufasjttd";
const live =
  process.env.WJB_LIVE_C3 === "1" &&
  process.env.WJB_CLOUD_ENV === "development" &&
  process.env.WJB_SUPABASE_DEV_PROJECT_REF === REF;

describe.skipIf(!live)("C-3 실서버(개발 프로젝트)", () => {
  it(
    "엔진 → 끊김 → 이어서 게시 → 다시 읽기 일치 · 두 번째 작업 취소 → 잔여 0",
    { timeout: 900_000 },
    async () => {
      const key = process.env.WJB_SUPABASE_DEV_SERVICE_ROLE_KEY!,
        mgmt = process.env.WJB_SUPABASE_DEV_MANAGEMENT_TOKEN!;
      const origin = `https://${REF}.supabase.co`,
        gw = `${origin}/functions/v1/wjb-gateway`,
        bucket = "wjb-v2-dev-assets";
      const publishable = /PUBLISHABLE_KEY: &str = "([^"]+)"/.exec(
        readFileSync("src-tauri/src/online.rs", "utf8"),
      )![1]!;
      const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
      const checks: { name: string; passed: boolean; extra?: unknown }[] = [];
      const check = (name: string, ok: boolean, extra?: unknown) => checks.push({ name, passed: ok, extra });
      const admin = async (method: string, path: string, body?: unknown) => {
        const r = await fetch(origin + path, {
          method,
          headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
          redirect: "error",
        });
        return { status: r.status, body: await r.json().catch(() => null) };
      };
      const sql = async (query: string) => {
        const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
          method: "POST",
          headers: { authorization: `Bearer ${mgmt}`, "content-type": "application/json" },
          body: JSON.stringify({ query, read_only: false }),
          redirect: "error",
        });
        if (!r.ok) throw Error("DEV_SQL_" + r.status);
        return r.json();
      };
      let token = "";
      const deviceId = randomUUID();
      // Rust migration.rs와 같은 경로·본문·머리
      const send = async (
        method: string,
        path: string,
        body: unknown,
        headers: Record<string, string> = {},
      ) => {
        const raw = body instanceof Uint8Array;
        const r = await fetch(gw + path, {
          method,
          headers: {
            apikey: publishable,
            authorization: `Bearer ${token}`,
            "content-type": raw ? "application/octet-stream" : "application/json",
            ...headers,
          },
          body: raw ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(150_000),
        });
        const v = await r.json().catch(() => null);
        if (r.status !== 200)
          throw Error(
            typeof v?.error === "string"
              ? v.error
              : typeof v?.error?.code === "string"
                ? v.error.code
                : `HTTP_${r.status}`,
          );
        return v;
      };
      const journals = new Map<string, MigrationJournal>();
      let interrupt: ((action: string) => boolean) | null = null;
      let cancelAssetCalls = 0;
      let stage = "setup";
      const t: PreviewMigration = {
        async device() {
          const v = await send("POST", "/v2/devices", { deviceId });
          if (v.registered !== true) throw Error("DEVICE");
        },
        async command(jobId, action, params) {
          if (interrupt?.(action)) throw Error("NETWORK");
          return send("POST", `/v2/migrations/${jobId}/${action}`, { deviceId, params });
        },
        async putAsset(ws, objectId, digest, bytes) {
          if (sha(bytes) !== digest) throw Error("INTEGRITY_MISMATCH");
          const v = await send("PUT", `/v2/workspaces/${ws}/assets/${objectId}/content`, bytes, {
            "x-wjb-device-id": deviceId,
            "x-wjb-generation": "1",
          });
          if (v.state !== "ready") throw Error("SERVER_RESPONSE");
        },
        async cancelAsset(ws, objectId) {
          cancelAssetCalls++;
          await send("POST", `/v2/workspaces/${ws}/assets/${objectId}/cancel`, { deviceId, generation: "1" });
        },
        async journals() {
          return [...journals.values()].map((j) => structuredClone(j));
        },
        async saveJournal(j) {
          journals.set(j.jobId, structuredClone(j));
        },
        async removeJournal(id) {
          journals.delete(id);
        },
      };

      const dir = mkdtempSync(join(tmpdir(), "wjb-c3-live-"));
      mkdirSync(join(dir, "s"));
      writeFileSync(join(dir, "s", ".v2-poc-only"), "synthetic");
      const created = { users: [] as string[], workspaces: [] as string[], jobs: [] as string[] };
      const report: Record<string, unknown> = {
        startedAt: new Date().toISOString(),
        projectRef: REF,
        productionTouched: false,
        mailSent: false,
        engine: "src/preview/migrationEngine.ts + migrationRunner.ts (sql.js, pure-JS SHA-256)",
        transport: "edge-gateway-http (same paths/bodies as src-tauri/src/migration.rs)",
        checks,
        timing: {},
      };
      const SQL = await initSqlJs();
      try {
        const file = join(dir, "s", "source.db");
        buildSourceFixture(file, 20, 2500);
        const snapshot = new Uint8Array(readFileSync(file));
        const email = `wjb-c3-${randomUUID()}@example.invalid`;
        const u = await admin("POST", "/auth/v1/admin/users", { email, email_confirm: true });
        if (u.status !== 200) throw Error("CREATE_USER_" + u.status);
        created.users.push(u.body.id);
        const link = await admin("POST", "/auth/v1/admin/generate_link", { type: "magiclink", email });
        const otp = link.body?.email_otp ?? link.body?.properties?.email_otp;
        const v = await fetch(`${origin}/auth/v1/verify`, {
          method: "POST",
          headers: { apikey: publishable, "content-type": "application/json" },
          body: JSON.stringify({ type: "email", email, token: otp }),
        });
        token = (await v.json()).access_token;
        check("login", v.status === 200 && !!token);

        stage = "publish";
        // 1) 엔진(앱 코드) → 끊김 → 이어서 → 게시
        let t0 = Date.now();
        const ws = randomUUID();
        created.workspaces.push(ws);
        // 013(D-a): 크기 예산을 작게 해 페이지 수 ≠ 올림(기록/1000)을 실서버에서 확인
        const p = prepareCopy(SQL, snapshot, {
          workspaceId: ws,
          sourceWorkspaceId: randomUUID(),
          pageBytes: 300_000,
        });
        check("size_based_pages", p.pages.length > Math.ceil(p.recordsTotal / 1000), {
          pages: p.pages.length,
          byRows: Math.ceil(p.recordsTotal / 1000),
        });
        (report.timing as Record<string, number>).prepareSeconds = (Date.now() - t0) / 1000;
        const job = randomUUID();
        created.jobs.push(job);
        const opts = { jobId: job, ownerId: u.body.id, snapshotId: randomUUID(), journalEvery: 1 };
        let pages = 0;
        interrupt = (a) => a === "upload_page" && ++pages === 2;
        await expect(runMigration(t, p, opts)).rejects.toThrow("NETWORK");
        interrupt = null;
        check("interrupted_after_first_page", journals.get(job)?.phase === "uploading-records");
        // D6(016): 게시 직전에 끊고, 그림 확인 시각을 10분 전으로 돌린 뒤 이어서 게시 → 입출력 판이 그대로면 게시된다
        interrupt = (a) => a === "publication";
        await expect(runMigration(t, p, opts)).rejects.toThrow("NETWORK");
        interrupt = null;
        await sql(
          `UPDATE wjb_migration.asset SET verified_at=clock_timestamp()-interval '10 minutes' WHERE job_id='${job}';`,
        );
        t0 = Date.now();
        const receipt = await runMigration(t, p, opts);
        (report.timing as Record<string, number>).uploadPublishSeconds = (Date.now() - t0) / 1000;
        check(
          "published_with_old_attest_d6",
          (receipt as { status?: string; receipt?: { status?: string } }).status === "poc-verified" ||
            (receipt as { receipt?: { status?: string } }).receipt?.status === "poc-verified",
          { records: p.recordsTotal, pages: p.pages.length, assets: p.assets.length },
        );
        const mh = journals.get(job)!.manifestHash!;
        const back = await send("POST", `/v2/migrations/${job}/workspace`, {
          deviceId,
          params: { manifestHash: mh },
        });
        const canon = (r: { table: string; key: string; value: unknown }[]) =>
          // jsonb는 키 순서를 바꾼다 — 키 정렬 정준 JSON으로 비교
          r.map((x) => canonical([x.table, x.key, x.value])).sort();
        const same =
          back.envelope.records.length === p.recordsTotal &&
          JSON.stringify(canon(back.envelope.records)) === JSON.stringify(canon(p.pages.flat()));
        check("read_back_matches_engine_records", same, { records: back.envelope.records.length });
        const a0 = p.assets[0]!;
        const got = await fetch(`${gw}/v2/workspaces/${ws}/assets/${a0.objectId}/content`, {
          headers: {
            apikey: publishable,
            authorization: `Bearer ${token}`,
            "x-wjb-device-id": deviceId,
            "x-wjb-generation": "1",
          },
        });
        check(
          "image_download_matches",
          got.status === 200 && sha(new Uint8Array(await got.arrayBuffer())) === a0.sha256,
        );
        check("source_snapshot_unchanged", sha(snapshot) === sha(readFileSync(file)));
        // D-1 읽기 경로(016·gateway v10): 목록 → 머리 → 기록 페이지 = 앱 엔진이 만든 기록
        const rd = (action: string, params: unknown) =>
          send("POST", `/v2/read/${action}`, { deviceId, params });
        const list = (await rd("list", {})).workspaces as {
          workspaceId: string;
          records: number;
          manifestHash: string;
        }[];
        const mine = list.find((w) => w.workspaceId === ws);
        const head = await rd("header", { workspaceId: ws });
        const recs: { table: string; key: string; value: unknown }[] = [];
        let after: unknown = null,
          readPages = 0;
        for (;;) {
          const pg = await rd("records", {
            workspaceId: ws,
            manifestHash: head.manifestHash,
            after,
            limit: 1000,
          });
          recs.push(...pg.records);
          readPages++;
          if (!pg.more) break;
          after = pg.next;
        }
        check(
          "read_list_header_pages_match",
          mine?.records === p.recordsTotal &&
            head.assets.length === p.assets.length &&
            JSON.stringify(canon(recs)) === JSON.stringify(canon(p.pages.flat())),
          { records: recs.length, readPages },
        );
        let changed = "";
        try {
          await rd("records", { workspaceId: ws, manifestHash: "0".repeat(64), after: null, limit: 10 });
        } catch (e) {
          changed = (e as Error).message;
        }
        check("read_refuses_changed_manifest", changed === "READ_MANIFEST_CHANGED");

        stage = "cancel";
        // 2) 두 번째 작업: 그림 1개 올린 뒤 멈춤 → 취소(올린 그림 지우기 + 예약만 된 것) → 할당량 0
        const ws2 = randomUUID();
        created.workspaces.push(ws2);
        const p2 = prepareCopy(SQL, snapshot, { workspaceId: ws2, sourceWorkspaceId: randomUUID() });
        const job2 = randomUUID();
        created.jobs.push(job2);
        // 그림을 올리고 확인까지 한 뒤 게시 직전에 끊김 → 취소(올린 그림 지우기)
        interrupt = (a) => a === "publication";
        await expect(
          runMigration(t, p2, { jobId: job2, ownerId: u.body.id, snapshotId: randomUUID(), journalEvery: 1 }),
        ).rejects.toThrow("NETWORK");
        interrupt = null;
        const t1 = Date.now();
        const c = await cancelMigration(t, job2);
        (report.timing as Record<string, number>).cancelSeconds = (Date.now() - t1) / 1000;
        const used = await sql(`SELECT used_bytes FROM wjb_gateway.workspace WHERE id='${ws2}';`);
        const objs = await sql(
          `SELECT count(*) n FROM storage.objects WHERE bucket_id='${bucket}' AND name LIKE '${ws2}/%';`,
        );
        check(
          "cancel_after_partial_upload_cleans",
          c.state === "canceled" && String(used[0]?.used_bytes) === "0" && String(objs[0]?.n) === "0",
          { usedBytes: used[0]?.used_bytes, objects: objs[0]?.n, cancelAssetCalls, assets: p2.assets.length },
        );
        await expect(
          runMigration(t, p2, { jobId: job2, ownerId: u.body.id, snapshotId: "x", journalEvery: 1 }),
        ).rejects.toThrow();
      } catch (e) {
        report.failure = `${stage}:${String((e as Error).message).slice(0, 200)}`;
        const w2 = created.workspaces[1];
        if (w2)
          report.debug = {
            cancelAssetCalls,
            objects: await sql(
              `SELECT name FROM storage.objects WHERE bucket_id='${bucket}' AND name LIKE '${w2}/%';`,
            ).catch(() => null),
            assets: await sql(
              `SELECT state,io_version,lease_mode FROM wjb_gateway.asset WHERE workspace_id='${w2}';`,
            ).catch((e) => String(e)),
          };
      } finally {
        const cleanup: Record<string, unknown> = {};
        try {
          for (const w of created.workspaces) {
            const list = await admin("POST", `/storage/v1/object/list/${bucket}`, { prefix: w, limit: 1000 });
            const names = ((list.body ?? []) as { name: string }[]).map((o) => `${w}/${o.name}`);
            if (names.length) await admin("DELETE", `/storage/v1/object/${bucket}`, { prefixes: names });
          }
          for (let i = 0; i < created.jobs.length; i++) {
            const j = created.jobs[i],
              w = created.workspaces[i];
            await sql(
              `BEGIN;DELETE FROM wjb_migration.upload_page WHERE upload_id='${j}';DELETE FROM wjb_migration.upload WHERE id='${j}';DELETE FROM wjb_migration.workspace_record WHERE job_id='${j}';DELETE FROM wjb_migration.workspace_header WHERE job_id='${j}';DELETE FROM wjb_migration.document WHERE job_id='${j}';DELETE FROM wjb_migration.asset WHERE job_id='${j}';DELETE FROM wjb_migration.job WHERE id='${j}';` +
                (w
                  ? `DELETE FROM wjb_gateway.recovery_audit WHERE workspace_id='${w}';DELETE FROM wjb_gateway.io_intent WHERE workspace_id='${w}';DELETE FROM wjb_gateway.asset WHERE workspace_id='${w}';DELETE FROM wjb_gateway.workspace WHERE id='${w}';`
                  : "") +
                "COMMIT;",
            );
          }
          await sql(`DELETE FROM wjb_gateway.device WHERE id='${deviceId}';`);
          for (const id of created.users) {
            await sql(`DELETE FROM wjb_v2_cloud.blocked_session WHERE user_id='${id}';`);
            await admin("DELETE", `/auth/v1/admin/users/${id}`);
          }
          const left = await sql(
            `SELECT (SELECT count(*) FROM wjb_migration.job) jobs,(SELECT count(*) FROM wjb_migration.upload) uploads,(SELECT count(*) FROM wjb_migration.workspace_record) records,(SELECT count(*) FROM wjb_gateway.workspace) workspaces,(SELECT count(*) FROM wjb_gateway.asset) assets,(SELECT count(*) FROM wjb_gateway.device WHERE id='${deviceId}') devices,(SELECT count(*) FROM storage.objects WHERE bucket_id='${bucket}') objects,(SELECT count(*) FROM auth.users WHERE email LIKE 'wjb-c3-%') users;`,
          );
          Object.assign(cleanup, left[0]);
          cleanup.zero = Object.values(left[0]).every((n) => String(n) === "0");
        } catch (e) {
          cleanup.error = String((e as Error).message).slice(0, 120);
        }
        rmSync(dir, { recursive: true, force: true });
        report.cleanup = cleanup;
        report.passed =
          !report.failure && checks.length >= 10 && checks.every((c) => c.passed) && cleanup.zero === true;
        report.finishedAt = new Date().toISOString();
        writeFileSync(
          "docs/v2-design/evidence/preview-dev-c3-engine-live.json",
          JSON.stringify(report, null, 2) + "\n",
        );
      }
      expect(report.failure).toBeUndefined();
      expect(report.passed).toBe(true);
    },
  );
});
