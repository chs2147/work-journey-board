// 브라우저 모드(개발·E2E)용 가짜 이관 서버 — 네트워크 없음, 메모리 상태. 실제 서버 순서(페이지·시작·그림·확인·게시·취소)만 흉내
import type { MigrationJournal, PreviewMigration } from "./index";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** ?migrationDelay=밀리초 — 진행 화면을 보려고 늦출 때 */
const delay = () => Number(new URLSearchParams(location.search).get("migrationDelay") ?? 40);
/** ?migrationFail=publication — 그 명령에서 한 번 끊김(이어하기 확인용) */
let failOnce = new URLSearchParams(location.search).get("migrationFail");
interface FakeJob {
  pages: Set<number>;
  started: boolean;
  assets: Map<string, string>;
  state: string;
  header?: Record<string, unknown>;
  records: Map<number, unknown[]>;
  createdAt: string;
}
const jobs = new Map<string, FakeJob>();
/** 가짜 서버에 올라간 그림 본문(objectId → 바이트) — 가짜 "내 온라인 공간"(browserPreviewSpaces)이 읽는다 */
const assetBodies = new Map<string, Uint8Array>();
/** 게시된 가짜 공간(D단계 브라우저 모드 E2E) */
export function fakePublishedSpaces() {
  return [...jobs.values()]
    .filter((j) => j.state === "connected" && j.header)
    .map((j) => ({
      header: j.header as Record<string, unknown> & {
        workspaceId: string;
        assets: { objectId: string; sha256: string }[];
      },
      records: [...j.records.entries()].sort(([a], [b]) => a - b).flatMap(([, r]) => r),
      createdAt: j.createdAt,
      body: (objectId: string) => assetBodies.get(objectId),
    }));
}
/** 지금 살아 있는 공간 수(취소되지 않은 시작된 작업) — 가짜 계정 한도용 */
export function fakeLiveSpaceCount() {
  return [...jobs.values()].filter((j) => j.started && j.state !== "canceled").length;
}
const journals = new Map<string, MigrationJournal>();
const MH = "c".repeat(64);

export const browserPreviewMigration: PreviewMigration = {
  async device() {
    await wait(delay());
  },
  async command(jobId, action, params) {
    await wait(delay());
    if (failOnce === action) {
      failOnce = null;
      throw new Error("NETWORK");
    }
    const j: FakeJob = jobs.get(jobId) ?? {
      pages: new Set(),
      started: false,
      assets: new Map(),
      state: "uploading",
      records: new Map(),
      createdAt: new Date().toISOString(),
    };
    jobs.set(jobId, j);
    switch (action) {
      case "upload_begin":
        j.header = params.header as Record<string, unknown>;
        return { uploadId: jobId };
      case "upload_status":
        return { received: [...j.pages].sort((a, b) => a - b) };
      case "upload_page":
        j.pages.add(params.index as number);
        j.records.set(params.index as number, params.records as unknown[]);
        return { stored: true };
      case "start_upload":
        // 서버(028)처럼 새 공간을 만들 때 계정 한도 확인
        if (!j.started) (await import("./browserPreviewAccount")).fakeSpaceGuard();
        j.started = true;
        j.state = "staging";
        return { state: "staging", manifestHash: MH };
      case "observe":
        return { assetState: j.assets.get(params.objectId as string) ?? "reserved", operationSettled: true };
      case "renew":
      case "attest":
        return { ok: true };
      case "publication":
        return j.state === "connected" ? { state: "connected" } : { state: "absent", serverFence: "1" };
      case "prepare_publish":
        return { token: crypto.randomUUID(), fence: "2" };
      case "publish":
        j.state = "connected";
        return { status: "poc-verified", workspaceId: jobId };
      case "cancel":
        j.state = "cancel_fenced";
        return { state: "cancel_fenced", publishBlocked: true };
      case "confirm-absent":
        return { absentConfirmed: true };
      case "finish_cancel":
        j.state = "canceled";
        return { state: "canceled" };
    }
    throw new Error("UNKNOWN");
  },
  async putAsset(_ws, objectId, _sha, bytes) {
    await wait(delay() * 2);
    assetBodies.set(objectId, bytes);
    for (const j of jobs.values()) if (j.started) j.assets.set(objectId, "ready");
  },
  async cancelAsset() {
    await wait(delay());
  },
  async journals() {
    return [...journals.values()].map((j) => structuredClone(j));
  },
  async saveJournal(j) {
    // 실앱(Rust migration.rs Journal::valid)과 같은 형식 검사 — 작업·소유자·공간·사본 ID는 UUID만
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (![j.jobId, j.ownerId, j.workspaceId, j.snapshotId].every((v) => uuid.test(v)))
      throw new Error("STORE");
    journals.set(j.jobId, structuredClone(j));
  },
  async removeJournal(id) {
    journals.delete(id);
  },
};
