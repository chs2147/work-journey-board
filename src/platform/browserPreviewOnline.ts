// 브라우저 모드(개발·E2E)용 가짜 Preview 계정 — 네트워크 없음. 인증번호 12345678만 통과, 메모리 상태
import type { OnlineStatus, PreviewOnline } from "./index";

const OUT: OnlineStatus = { state: "signedOut", email: null, accountId: null, serverCheckedAt: null };
let current: OnlineStatus = OUT;
let sentTo: string | null = null;
const now = () => Math.floor(Date.now() / 1000);

export const browserPreviewOnline: PreviewOnline = {
  async status() {
    return current;
  },
  async sendCode(email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error("INVALID_EMAIL");
    sentTo = email.trim();
  },
  async verifyCode(email, code) {
    if (email.trim() !== sentTo || code !== "12345678") throw new Error("CODE_REJECTED");
    current = {
      state: "signedIn",
      email: sentTo,
      accountId: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b",
      serverCheckedAt: now(),
    };
    return current;
  },
  async check() {
    if (current.state !== "signedIn") throw new Error("SIGNED_OUT");
    current = { ...current, serverCheckedAt: now() };
    return current;
  },
  async signOut() {
    current = OUT;
    sentTo = null;
    return current;
  },
};
