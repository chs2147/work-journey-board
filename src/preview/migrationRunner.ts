// C-3 이관 실행기(Connected Preview, docs/v2-design/84) — 준비된 이관 자료를 개발 서버로 올리고 게시·취소한다.
// - 통신은 PreviewMigration(Rust)만. 이어하기 기록 = ID·해시·크기·단계만.
// - 끊기면 같은 작업 ID로 다시 부르면 이어 간다(받은 페이지·확인된 그림은 건너뜀).
// - 원본 일지·원본 사본은 건드리지 않는다(실패·취소와 무관하게 로컬 일지는 그대로).
import type { MigrationJournal, MigrationJournalAsset, PreviewMigration } from "../platform";
import type { PreparedCopy } from "./migrationEngine";

export type MigrationStep =
  | { kind: "records"; sent: number; total: number }
  | { kind: "assets"; done: number; total: number; bytes: number; totalBytes: number }
  | { kind: "verify"; done: number; total: number }
  | { kind: "publish" }
  | { kind: "cancel"; done: number; total: number };

export interface RunOptions {
  jobId: string;
  ownerId: string;
  snapshotId: string;
  onProgress?: (step: MigrationStep) => void;
  signal?: AbortSignal;
  now?: () => number;
  randomUUID?: () => string;
  /** 그림 몇 개마다 기록을 저장할지(기록 파일 쓰기 횟수 줄이기) */
  journalEvery?: number;
}

export class MigrationAborted extends Error {
  constructor() {
    super("MIGRATION_ABORTED");
  }
}
const stopIf = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new MigrationAborted();
};

function freshJournal(p: PreparedCopy, o: RunOptions, now: number): MigrationJournal {
  return {
    version: 1,
    jobId: o.jobId,
    ownerId: o.ownerId,
    workspaceId: p.workspaceId,
    snapshotId: o.snapshotId,
    sourceHash: p.sourceHash,
    mappingHash: p.mappingHash,
    manifestHash: null,
    publishOperationId: null,
    cancelOperationId: null,
    pages: p.pages.length,
    records: p.recordsTotal,
    phase: "prepared",
    assets: p.assets.map((a) => ({ ...a, state: "pending" })),
    updatedAt: now,
  };
}

/** 같은 작업의 기록이면 이어 쓰고, 다른 자료로 만든 기록이면 멈춘다(사본이 바뀐 것) */
async function openJournal(t: PreviewMigration, p: PreparedCopy, o: RunOptions, now: number) {
  const old = (await t.journals()).find((j) => j.jobId === o.jobId);
  if (!old) return freshJournal(p, o, now);
  if (
    old.mappingHash !== p.mappingHash ||
    old.workspaceId !== p.workspaceId ||
    old.sourceHash !== p.sourceHash ||
    old.snapshotId !== o.snapshotId
  )
    throw new Error("MIGRATION_SOURCE_CHANGED");
  if (old.phase === "canceling" || old.phase === "canceled") throw new Error("MIGRATION_CANCELED");
  return old;
}

/** 올리기 → 그림 → 다시 확인 → 게시. 돌려주는 값 = 서버 게시 영수증 */
export async function runMigration(t: PreviewMigration, p: PreparedCopy, o: RunOptions) {
  const now = o.now ?? Date.now;
  const uuid = o.randomUUID ?? (() => crypto.randomUUID());
  const every = Math.max(1, o.journalEvery ?? 10);
  const j = await openJournal(t, p, o, now());
  const save = async (patch: Partial<MigrationJournal> = {}) => {
    Object.assign(j, patch, { updatedAt: now() });
    await t.saveJournal(j);
  };
  if (j.phase === "published") return { state: "connected", resumed: true };
  // 첫 통신 전에 기록부터 남긴다(바로 멈추거나 끊겨도 이어하기·취소 목록에 보이게)
  await save();
  await t.device();
  stopIf(o.signal);

  // 1) 기록 페이지(받은 것은 건너뜀) → 시작(서버가 조립·검증)
  if (!j.manifestHash) {
    await save({ phase: "uploading-records" });
    await t.command(o.jobId, "upload_begin", {
      header: p.header,
      pages: p.pages.length,
      records: p.recordsTotal,
    });
    const status = await t.command(o.jobId, "upload_status", {});
    const received = new Set((status.received as number[] | undefined) ?? []);
    let sent = received.size;
    o.onProgress?.({ kind: "records", sent, total: p.pages.length });
    for (let i = 0; i < p.pages.length; i++) {
      if (received.has(i)) continue;
      stopIf(o.signal);
      await t.command(o.jobId, "upload_page", { index: i, records: p.pages[i] });
      o.onProgress?.({ kind: "records", sent: ++sent, total: p.pages.length });
    }
    const started = await t.command(o.jobId, "start_upload", {});
    if (started.state !== "staging" || typeof started.manifestHash !== "string")
      throw new Error("SERVER_RESPONSE");
    await save({ manifestHash: started.manifestHash, phase: "uploading-assets" });
  }
  const manifestHash = j.manifestHash!;

  // 2) 그림: 예약 연장 → 올리기(Rust가 해시 재확인) → 서버 확인(gateway가 저장소에서 다시 읽어 해시)
  const totalBytes = j.assets.reduce((n, a) => n + a.bytes, 0);
  let done = j.assets.filter((a) => a.state === "attested").length;
  let doneBytes = j.assets.filter((a) => a.state === "attested").reduce((n, a) => n + a.bytes, 0);
  let unsaved = 0;
  const attest = (a: MigrationJournalAsset) =>
    t.command(o.jobId, "attest", { manifestHash, objectId: a.objectId });
  for (const a of j.assets) {
    if (a.state === "attested") continue;
    stopIf(o.signal);
    const ob = await t.command(o.jobId, "observe", { manifestHash, objectId: a.objectId });
    if (ob.assetState !== "ready") {
      if (ob.assetState === "reserved")
        await t.command(o.jobId, "renew", { manifestHash, objectId: a.objectId });
      const bytes = p.assetBytes.get(a.objectId);
      if (!bytes || bytes.length !== a.bytes) throw new Error("BLOB_REFERENCE");
      await t.putAsset(p.workspaceId, a.objectId, a.sha256, bytes);
      a.state = "uploaded";
    }
    await attest(a);
    a.state = "attested";
    done++;
    doneBytes += a.bytes;
    o.onProgress?.({ kind: "assets", done, total: j.assets.length, bytes: doneBytes, totalBytes });
    if (++unsaved >= every) {
      await save();
      unsaved = 0;
    }
  }
  await save({ phase: "publishing" });

  // 3) 게시 — 서버는 "확인한 입출력 판 = 지금 판"으로 판정(016, D6). 게시 직전 그림 재확인은 하지 않는다
  stopIf(o.signal);
  o.onProgress?.({ kind: "publish" });
  if (!j.publishOperationId) await save({ publishOperationId: uuid() });
  const operationId = j.publishOperationId!;
  const pub = await t.command(o.jobId, "publication", { manifestHash, operationId });
  let receipt: Record<string, unknown>;
  if (pub.state === "connected") receipt = pub;
  else {
    if (pub.state !== "absent" || typeof pub.serverFence !== "string")
      throw new Error("MIGRATION_PUBLISH_BUSY");
    const prep = await t.command(o.jobId, "prepare_publish", {
      manifestHash,
      operationId,
      expectedFence: pub.serverFence,
    });
    receipt = await t.command(o.jobId, "publish", {
      manifestHash,
      operationId,
      token: prep.token,
      fence: prep.fence,
    });
  }
  await save({ phase: "published" });
  return receipt;
}

/**
 * 저장소 지우기 확인은 늦을 수 있다 — 개발 서버 실측: 지운 뒤 약 60초 동안 저장소 캐시가 옛 본문을 돌려줘
 * gateway가 DELETE_NOT_CONFIRMED로 답한다(84문서 4절). 같은 요청을 약 100초까지 다시 보낸다.
 */
const RETRYABLE = new Set(["DELETE_NOT_CONFIRMED", "STORAGE_UNAVAILABLE", "NETWORK", "HTTP_503"]);
export const CANCEL_RETRY_MS = Object.freeze([2000, 5000, 10000, 20000, 30000, 30000]);
async function retrying<T>(
  f: () => Promise<T>,
  sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
) {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      const wait = CANCEL_RETRY_MS[i];
      if (wait === undefined || !RETRYABLE.has((e as Error).message)) throw e;
      await sleep(wait);
    }
  }
}

/** 취소: 게시 막기 → 올린 그림 지우기·부재 확인 → 끝. 로컬 일지는 그대로 */
export async function cancelMigration(
  t: PreviewMigration,
  jobId: string,
  o: Pick<RunOptions, "onProgress" | "now" | "randomUUID"> & { sleep?: (ms: number) => Promise<void> } = {},
) {
  const now = o.now ?? Date.now;
  const uuid = o.randomUUID ?? (() => crypto.randomUUID());
  const j = (await t.journals()).find((x) => x.jobId === jobId);
  if (!j) throw new Error("MIGRATION_NOT_FOUND");
  if (j.phase === "published") throw new Error("MIGRATION_ALREADY_PUBLISHED");
  const save = async (patch: Partial<MigrationJournal> = {}) => {
    Object.assign(j, patch, { updatedAt: now() });
    await t.saveJournal(j);
  };
  if (!j.manifestHash) {
    // 시작 전: 서버에는 페이지만(작업 없음) — 이 기기 기록만 지운다
    await t.removeJournal(jobId);
    return { state: "canceled", serverJob: false };
  }
  await t.device();
  if (!j.cancelOperationId) await save({ cancelOperationId: uuid(), phase: "canceling" });
  const manifestHash = j.manifestHash;
  const c = await t.command(jobId, "cancel", { manifestHash, operationId: j.cancelOperationId! });
  if (c.state === "connected") {
    await save({ phase: "published" });
    throw new Error("MIGRATION_ALREADY_PUBLISHED");
  }
  let done = 0;
  for (const a of j.assets) {
    if (a.state !== "absent") {
      await retrying(() => t.cancelAsset(j.workspaceId, a.objectId), o.sleep);
      await t.command(jobId, "confirm-absent", { manifestHash, objectId: a.objectId });
      a.state = "absent";
    }
    o.onProgress?.({ kind: "cancel", done: ++done, total: j.assets.length });
  }
  const fin = await t.command(jobId, "finish_cancel", { manifestHash });
  if (fin.state !== "canceled") throw new Error("MIGRATION_CANCEL_INCOMPLETE");
  await save({ phase: "canceled" });
  return { state: "canceled", serverJob: true };
}
