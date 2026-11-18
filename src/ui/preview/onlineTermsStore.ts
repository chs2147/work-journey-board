// G-8(docs/v2-design/104) 온라인 기능 안내 동의 — 이 기기 설정(config.json `onlineTerms`)에 판·시각만.
// 첫 로그인(인증번호 받기) 전에 한 번 묻고, 안내 판(TERMS_VERSION)이 바뀌면 다시 묻는다. 서버에는 보내지 않는다.
import { create } from "zustand";
import { loadAppProfile, loadBasePlatform, type Platform } from "../../platform";
import { TERMS_VERSION, termsAccepted, type TermsKind } from "../../shared/onlineTerms";

interface State {
  /** null = 아직 읽는 중 */
  accepted: boolean | null;
  acceptedAt: string | null;
  /** 열려 있는 안내(대화상자) */
  open: TermsKind | null;
}
export const useOnlineTerms = create<State>(() => ({ accepted: null, acceptedAt: null, open: null }));
const set = useOnlineTerms.setState;

/** 이 기기 설정을 쓰는 플랫폼. Connected Preview(별도 검증 앱)는 일지·설정 모듈을 불러오지 않는다 → 이번 실행 동안만 기억 */
let store: Promise<Platform | null> | null = null;
const configStore = () =>
  (store ??= loadAppProfile()
    .then((p) => (p.key === "connected-preview" ? null : loadBasePlatform()))
    .catch(() => null));

let loading: Promise<void> | null = null;
/** 설정에서 읽기(한 번) — 읽지 못하면 동의 안 한 것으로 */
export function loadTermsConsent(): Promise<void> {
  loading ??= (async () => {
    const base = await configStore();
    const saved = base
      ? await base.loadConfig().then(
          (c) => c?.onlineTerms ?? null,
          () => null,
        )
      : null;
    const ok = termsAccepted(saved);
    set({ accepted: ok, acceptedAt: ok ? (saved?.acceptedAt ?? null) : null });
  })();
  return loading;
}

/** 동의 기록 — 설정에 쓰지 못해도 이번 실행에서는 동의한 것으로(다음 실행에 다시 묻는다) */
export async function acceptTerms(now = new Date()): Promise<void> {
  const acceptedAt = now.toISOString();
  set({ accepted: true, acceptedAt });
  const base = await configStore();
  await base?.saveConfig({ onlineTerms: { version: TERMS_VERSION, acceptedAt } }).catch(() => undefined);
}

export const openTerms = (kind: TermsKind) => set({ open: kind });
export const closeTerms = () => set({ open: null });
