// 새 판 확인·설치 흐름(improve-1027v4-spec 1절 B안, 2026-10-27 사용자 확정): 앱을 켤 때 1번 + 설정 [업데이트 확인].
// 확인 → (새 판) 띠·레일 점 → [자세히·설치] 창 → 입력 저장 → 내려받기(진행) → SHA256 확인 → 일지 자동 백업 → 설치·다시 시작.
// 인터넷은 Platform.update*(Rust update.rs)만 쓴다. 웹 화면은 주소를 모른다.
import { create } from "zustand";
import { preUpdateBackup } from "../../data/session";
import type { UpdateInfo } from "../../platform";
import { STR } from "../../shared/strings";
import { flushAll, toast } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import { flushNote } from "../note/noteStore";
import { flushDraft } from "../summary/summaryStore";

export type UpdatePhase =
  "idle" | "checking" | "none" | "available" | "failed" | "downloading" | "installing" | "error";

interface UpdateState {
  phase: UpdatePhase;
  info: UpdateInfo | null;
  /** 확인 실패·설치 실패 글 */
  error: string | null;
  /** 내려받기 0~1 */
  progress: number;
  /** 마지막 확인 시각(ISO) */
  checkedAt: string | null;
  /** 띠 [나중에] — 이번 실행 동안 띠만 숨김(레일 점·설정은 그대로) */
  dismissed: boolean;
  dialogOpen: boolean;
}

export const useUpdate = create<UpdateState>(() => ({
  phase: "idle",
  info: null,
  error: null,
  progress: 0,
  checkedAt: null,
  dismissed: false,
  dialogOpen: false,
}));

const set = useUpdate.setState;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 새 판이 있는가(띠·레일 점·설정) */
export const hasUpdate = (s: UpdateState) =>
  !!s.info && (s.phase === "available" || s.phase === "downloading" || s.phase === "error");

let startChecked = false;

/** 앱을 켤 때 1번(실패해도 조용히 — 설정에 마지막 확인 결과만) */
export async function checkOnStart() {
  if (startChecked) return;
  startChecked = true;
  await check();
}

/** 설정 [업데이트 확인] */
export async function checkNow() {
  const { phase } = useUpdate.getState();
  if (phase === "checking" || phase === "downloading" || phase === "installing") return;
  await check();
  const s = useUpdate.getState();
  if (s.phase === "none") toast(STR.update.latest);
}

async function check() {
  const platform = useAppStore.getState().platform;
  if (!platform) return;
  set({ phase: "checking", error: null });
  try {
    const info = await platform.updateCheck();
    set({ phase: info ? "available" : "none", info, checkedAt: new Date().toISOString() });
  } catch (e) {
    set({ phase: "failed", error: message(e), checkedAt: new Date().toISOString() });
  }
}

export function dismissBanner() {
  set({ dismissed: true });
}

export function openUpdateDialog() {
  set({ dialogOpen: true });
}

export function closeUpdateDialog() {
  const { phase } = useUpdate.getState();
  if (phase === "downloading" || phase === "installing") return;
  set({ dialogOpen: false });
}

/** [내려받고 설치] — 입력 저장 → 내려받기·확인 → 일지 자동 백업 → 설치(앱이 닫히고 새 판이 열린다) */
export async function installUpdate() {
  const app = useAppStore.getState();
  const platform = app.platform;
  const j = app.journal;
  if (!platform || j.state !== "ready" || !useUpdate.getState().info) return;
  set({ phase: "downloading", progress: 0, error: null });
  try {
    await flushAll();
    await flushDraft();
    await flushNote();
    await platform.updateDownload((received, total) =>
      set({ progress: total > 0 ? Math.min(1, received / total) : 0 }),
    );
    set({ phase: "installing", progress: 1 });
    await preUpdateBackup(platform, j.driver, j.dataDir, platform.now());
    await platform.updateInstall();
    // 실앱은 여기서 닫힌다. 브라우저 모드는 설치하지 않는다
    if (platform.kind === "browser") toast(STR.update.browserOnly);
  } catch (e) {
    set({ phase: "error", error: message(e) });
  }
}

/** 릴리스 노트 본문(마크다운) → 보여 줄 줄: 제목(### )·글머리(- )·글, "설치 파일" 절부터는 뺀다 */
export function noteLines(md: string): { kind: "head" | "item" | "text"; text: string }[] {
  const out: { kind: "head" | "item" | "text"; text: string }[] = [];
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,6}\s*설치 파일/.test(line)) break;
    const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
    if (/^#{1,6}\s/.test(line)) out.push({ kind: "head", text: plain(line.replace(/^#{1,6}\s+/, "")) });
    else if (/^[-*]\s/.test(line)) out.push({ kind: "item", text: plain(line.replace(/^[-*]\s+/, "")) });
    else if (!line.startsWith("|")) out.push({ kind: "text", text: plain(line) });
  }
  return out;
}
