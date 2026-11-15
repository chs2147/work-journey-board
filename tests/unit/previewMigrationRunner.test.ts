// @vitest-environment node
// C-3 이관 실행기 — 서버 규칙을 흉내 낸 가짜 통신으로 이어하기·다시 확인·게시·취소 순서를 본다(네트워크 없음)
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { MigrationJournal, PreviewMigration } from "../../src/platform";
import type { PreparedCopy } from "../../src/preview/migrationEngine";
import { cancelMigration, MigrationAborted, runMigration } from "../../src/preview/migrationRunner";

const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SNAP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const oid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function prepared(pages = 3, assets = 4): PreparedCopy {
  const assetBytes = new Map<string, Uint8Array>();
  const list = Array.from({ length: assets }, (_, i) => {
    const b = new Uint8Array(100 + i).fill(i + 1);
    assetBytes.set(oid(i + 1), b);
    return { objectId: oid(i + 1), sha256: sha(b), bytes: b.length };
  });
  return {
    workspaceId: WS,
    sourceHash: "1".repeat(64),
    mappingHash: "2".repeat(64),
    header: { assets: list } as never,
    pages: Array.from({ length: pages }, (_, i) => [{ table: "entry_item", key: String(i), value: {} }]),
    recordsTotal: pages,
    assets: list,
    assetBytes,
  };
}

/** 서버 흉내: 페이지·시작·그림 상태·확인 시각(60초)·게시 울타리·취소 */
function fakeServer(opts: { failAt?: (action: string, n: number) => boolean } = {}) {
  let clock = 0;
  const s = {
    pages: new Set<number>(),
    started: false,
    assets: new Map<string, { state: string; verifiedAt: number | null; stored: boolean }>(),
    published: false,
    canceled: false,
    publishOp: null as string | null,
    calls: [] as string[],
    journals: new Map<string, MigrationJournal>(),
    puts: 0,
  };
  let count = 0;
  const t: PreviewMigration = {
    async device() {},
    async command(job, action, params) {
      expect(job).toBe(JOB);
      s.calls.push(action);
      if (opts.failAt?.(action, ++count)) throw new Error("NETWORK");
      clock += 1;
      switch (action) {
        case "upload_begin":
          return { uploadId: job };
        case "upload_status":
          return { received: [...s.pages].sort() };
        case "upload_page":
          s.pages.add(params.index as number);
          return { stored: true };
        case "start_upload":
          if (s.pages.size !== 3) throw new Error("MIGRATION_UPLOAD_INCOMPLETE");
          s.started = true;
          for (const a of prepared().assets)
            if (!s.assets.has(a.objectId))
              s.assets.set(a.objectId, { state: "reserved", verifiedAt: null, stored: false });
          return { state: "staging", manifestHash: "3".repeat(64) };
        case "observe":
          return { assetState: s.assets.get(params.objectId as string)!.state, operationSettled: true };
        case "renew":
          return { renewed: true };
        case "attest": {
          const a = s.assets.get(params.objectId as string)!;
          if (a.state !== "ready") throw new Error("ASSET_NOT_READY");
          a.verifiedAt = clock;
          return { attested: true };
        }
        case "publication":
          if (s.published) return { state: "connected" };
          s.publishOp = params.operationId as string;
          return { state: "absent", serverFence: "2" };
        case "prepare_publish":
          return { token: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", fence: "3" };
        case "publish":
          // 60초 규칙 흉내: 마지막 확인이 최근 N번 호출 안이어야
          for (const a of s.assets.values())
            if (a.state !== "ready" || a.verifiedAt === null || clock - a.verifiedAt > 10)
              throw new Error("MIGRATION_NOT_VERIFIED");
          s.published = true;
          return { status: "poc-verified" };
        case "cancel":
          s.canceled = true;
          for (const a of s.assets.values()) a.state = "cleanup";
          return { state: "cancel_fenced", publishBlocked: true };
        case "confirm-absent": {
          const a = s.assets.get(params.objectId as string)!;
          if (a.stored) throw new Error("DELETE_NOT_CONFIRMED");
          a.state = "canceled";
          return { absentConfirmed: true };
        }
        case "finish_cancel":
          return { state: [...s.assets.values()].every((a) => a.state === "canceled") ? "canceled" : "x" };
      }
      throw new Error("UNKNOWN_ACTION");
    },
    async putAsset(ws, objectId, digest, bytes) {
      expect(ws).toBe(WS);
      expect(sha(bytes)).toBe(digest);
      s.puts++;
      const a = s.assets.get(objectId)!;
      a.state = "ready";
      a.stored = true;
    },
    async cancelAsset(_ws, objectId) {
      const a = s.assets.get(objectId)!;
      a.stored = false;
      a.state = "canceled";
    },
    async journals() {
      return [...s.journals.values()].map((j) => structuredClone(j));
    },
    async saveJournal(j) {
      // 기록 = ID·해시·크기·단계만(기록 내용·그림 바이트 없음)
      expect(JSON.stringify(j)).not.toMatch(/entry_item|"value"/);
      s.journals.set(j.jobId, structuredClone(j));
    },
    async removeJournal(id) {
      s.journals.delete(id);
    },
  };
  return { t, s };
}
const opts = { jobId: JOB, ownerId: OWNER, snapshotId: SNAP, journalEvery: 1 };

describe("C-3 이관 실행기", () => {
  it("기록 → 그림 → 게시 직전 다시 확인 → 게시", async () => {
    const { t, s } = fakeServer();
    const steps: string[] = [];
    const r = await runMigration(t, prepared(), { ...opts, onProgress: (p) => steps.push(p.kind) });
    expect(r).toEqual({ status: "poc-verified" });
    expect(s.published).toBe(true);
    expect(s.puts).toBe(4);
    expect(s.calls.filter((c) => c === "attest").length).toBe(8); // 올린 뒤 4 + 게시 전 4
    expect(steps).toContain("verify");
    expect(s.journals.get(JOB)!.phase).toBe("published");
    // 다시 불러도 다시 올리지 않는다
    await runMigration(t, prepared(), opts);
    expect(s.puts).toBe(4);
  });

  it("끊긴 뒤 이어서: 받은 페이지·확인된 그림은 건너뛴다", async () => {
    const fail = { on: true };
    const { t, s } = fakeServer({ failAt: (a, n) => fail.on && ((a === "upload_page" && n === 4) || false) });
    await expect(runMigration(t, prepared(), opts)).rejects.toThrow("NETWORK");
    expect(s.pages.size).toBe(1);
    fail.on = false;
    const before = s.calls.filter((c) => c === "upload_page").length;
    await runMigration(t, prepared(), opts);
    expect(s.calls.filter((c) => c === "upload_page").length - before).toBe(2);
    expect(s.published).toBe(true);

    // 그림 중간에 끊김 → 이어서 남은 것만 올림
    const g = fakeServer({ failAt: (a, n) => a === "attest" && n === 12 });
    await expect(runMigration(g.t, prepared(), opts)).rejects.toThrow("NETWORK");
    const putsBefore = g.s.puts;
    await runMigration(g.t, prepared(), opts);
    expect(g.s.puts).toBe(4);
    expect(putsBefore).toBeGreaterThan(0);
  });

  it("멈춤(신호)·다른 사본으로 이어하기는 거절", async () => {
    const { t, s } = fakeServer();
    const ac = new AbortController();
    const run = runMigration(t, prepared(), {
      ...opts,
      signal: ac.signal,
      onProgress: (p) => p.kind === "assets" && ac.abort(),
    });
    await expect(run).rejects.toBeInstanceOf(MigrationAborted);
    expect(s.published).toBe(false);
    const other = { ...prepared(), mappingHash: "9".repeat(64) };
    await expect(runMigration(t, other, opts)).rejects.toThrow("MIGRATION_SOURCE_CHANGED");
  });

  it("취소: 게시 막기 → 올린 그림 지우기·부재 확인 → 끝, 게시 뒤에는 취소 안 됨", async () => {
    const { t, s } = fakeServer({ failAt: (a) => a === "publication" });
    await expect(runMigration(t, prepared(), opts)).rejects.toThrow("NETWORK");
    // 지운 뒤 확인이 늦으면(저장소 캐시) 같은 요청을 다시 — 두 번 실패 뒤 성공
    let late = 2;
    const cancelAsset = t.cancelAsset;
    t.cancelAsset = async (ws, id) => {
      if (late-- > 0) throw new Error("DELETE_NOT_CONFIRMED");
      return cancelAsset(ws, id);
    };
    const waits: number[] = [];
    const r = await cancelMigration(t, JOB, { sleep: async (ms) => void waits.push(ms) });
    expect(r).toEqual({ state: "canceled", serverJob: true });
    expect(waits).toEqual([2000, 5000]);
    expect([...s.assets.values()].every((a) => a.state === "canceled" && !a.stored)).toBe(true);
    expect(s.journals.get(JOB)!.phase).toBe("canceled");
    await expect(runMigration(t, prepared(), opts)).rejects.toThrow("MIGRATION_CANCELED");

    const p = fakeServer();
    await runMigration(p.t, prepared(), opts);
    await expect(cancelMigration(p.t, JOB)).rejects.toThrow("MIGRATION_ALREADY_PUBLISHED");

    // 시작 전 취소 = 이 기기 기록만
    const q = fakeServer({ failAt: (a) => a === "start_upload" });
    await expect(runMigration(q.t, prepared(), opts)).rejects.toThrow("NETWORK");
    expect(await cancelMigration(q.t, JOB)).toEqual({ state: "canceled", serverJob: false });
    expect(q.s.journals.size).toBe(0);
  });
});
