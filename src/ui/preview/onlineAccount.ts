// 온라인 계정(docs/v2-design/95 UX-4 U3) — Preview 첫 화면과 설정 › 계정이 함께 쓴다.
// 토큰은 Rust·OS 보안 저장소에만 있고 화면은 상태(이메일·계정 ID·서버 확인 시각)만 본다.
import { create } from "zustand";
import { loadPreviewOnline, type OnlineStatus, type PreviewOnline } from "../../platform";
import { STR } from "../../shared/strings";

type Busy = "send" | "verify" | "check" | "signOut" | null;
interface State {
  status: OnlineStatus | null;
  busy: Busy;
  error: string | null;
  /** 인증번호를 보낸 이메일(받은 번호를 넣는 단계) */
  sentTo: string | null;
}
export const useOnlineAccount = create<State>(() => ({
  status: null,
  busy: null,
  error: null,
  sentTo: null,
}));
const get = useOnlineAccount.getState;
const set = useOnlineAccount.setState;

const P = STR.connectedPreview;
export const accountErrText = (e: unknown) => {
  const code = e instanceof Error ? e.message : String(e);
  return P.errors[code] ?? P.errors.UNKNOWN ?? code;
};

let api: PreviewOnline | null = null;
async function online() {
  api ??= await loadPreviewOnline();
  return api;
}

async function run(what: NonNullable<Busy>, f: (o: PreviewOnline) => Promise<OnlineStatus | void>) {
  const o = await online();
  set({ busy: what, error: null });
  try {
    const s = await f(o);
    if (s) set({ status: s });
    return true;
  } catch (e) {
    // 서버가 로그인을 끝냈으면 화면도 로그아웃 상태로
    set({ error: accountErrText(e), status: await o.status().catch(() => get().status) });
    return false;
  } finally {
    set({ busy: null });
  }
}

/** 앱을 켤 때 한 번: 저장된 로그인 상태 → 로그인돼 있으면 서버 확인 */
export async function initAccount() {
  const o = await online();
  const s = await o.status().catch(() => null);
  set({ status: s });
  if (s?.state === "signedIn") await run("check", (x) => x.check());
}
export async function sendCode(email: string) {
  const to = email.trim();
  if (await run("send", (o) => o.sendCode(to))) set({ sentTo: to });
}
export async function resendCode() {
  const to = get().sentTo;
  if (to) await run("send", (o) => o.sendCode(to));
}
export async function verifyCode(code: string) {
  const to = get().sentTo;
  if (to && (await run("verify", (o) => o.verifyCode(to, code.trim())))) set({ sentTo: null });
}
export const otherEmail = () => set({ sentTo: null, error: null });
export const recheck = () => run("check", (o) => o.check());
/** 로그아웃만(열린 공간이 없을 때). 열린 공간이 있으면 onlineSpaceStore.signOutFromSpace */
export const signOutOnly = () => run("signOut", (o) => o.signOut());

export const signedInOf = (s: OnlineStatus | null) => s?.state === "signedIn";
