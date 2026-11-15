// 브라우저 모드(개발·E2E)용 가짜 이관 서버 — 네트워크 없음, 메모리 상태. 실제 서버 순서(페이지·시작·그림·확인·게시·취소)만 흉내
import type { MigrationJournal, PreviewMigration } from "./index";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** ?migrationDelay=밀리초 — 진행 화면을 보려고 늦출 때 */
const delay = () => Number(new URLSearchParams(location.search).get("migrationDelay") ?? 40);
/** ?migrationFail=publication — 그 명령에서 한 번 끊김(이어하기 확인용) */
let failOnce = new URLSearchParams(location.search).get("migrationFail");
const jobs = new Map<
  string,
  { pages: Set<number>; started: boolean; assets: Map<string, string>; state: string }
>();
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
    const j = jobs.get(jobId) ?? { pages: new Set(), started: false, assets: new Map(), state: "uploading" };
    jobs.set(jobId, j);
    switch (action) {
      case "upload_begin":
        return { uploadId: jobId };
      case "upload_status":
        return { received: [...j.pages].sort((a, b) => a - b) };
      case "upload_page":
        j.pages.add(params.index as number);
        return { stored: true };
      case "start_upload":
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
  async putAsset(_ws, objectId) {
    await wait(delay() * 2);
    for (const j of jobs.values()) if (j.started) j.assets.set(objectId, "ready");
  },
  async cancelAsset() {
    await wait(delay());
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
