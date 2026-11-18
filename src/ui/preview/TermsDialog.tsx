// G-8(docs/v2-design/104) 개인정보 안내 · 이용 안내 — 앱 안 대화상자(최상위 레이어, 외부 페이지·통신 없음).
// 설정 › 계정의 [개인정보 안내]·[이용 안내], 로그인 동의 줄의 같은 단추가 연다. 두 안내는 위 탭으로 오간다.
import { useEffect, useRef } from "react";
import { STR } from "../../shared/strings";
import { ONLINE_TERMS, withContact, type TermsKind } from "../../shared/onlineTerms";
import styles from "./TermsDialog.module.css";
import { closeTerms, openTerms, useOnlineTerms } from "./onlineTermsStore";

const A = STR.onlineSpaces.account;
const KINDS: TermsKind[] = ["privacy", "terms"];
const label = (k: TermsKind) => (k === "privacy" ? A.privacy : A.terms);

export function TermsDialog() {
  const open = useOnlineTerms((s) => s.open);
  if (!open) return null;
  return <TermsDialogBody kind={open} />;
}

function TermsDialogBody({ kind }: { kind: TermsKind }) {
  const ref = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // 메모 사진 크게 보기(ImageBoxView, 1.24.2)와 같은 방식: 최상위 레이어 + 키는 대화상자 안에서 끝(Esc가 설정 화면을 닫거나
  // 전역 단축키가 뒤 화면을 바꾸지 않게), 닫으면 연 단추로 초점을 돌려준다
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const prev = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    const key = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        closeTerms();
      }
    };
    d.addEventListener("keydown", key);
    return () => {
      d.removeEventListener("keydown", key);
      if (d.open) d.close();
      prev?.focus?.();
    };
  }, []);
  useEffect(() => {
    body.current?.scrollTo?.({ top: 0 });
  }, [kind]);
  const doc = ONLINE_TERMS[kind];
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={A.termsDialog}
      onCancel={(e) => {
        e.preventDefault();
        closeTerms();
      }}
      data-testid="terms-dialog"
    >
      <div className={styles.tabs} role="tablist" aria-label={A.termsDialog}>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === kind}
            className={styles.tab}
            onClick={() => openTerms(k)}
            data-testid={`terms-tab-${k}`}
          >
            {label(k)}
          </button>
        ))}
      </div>
      <div ref={body} className={styles.body} role="tabpanel" tabIndex={0} data-testid="terms-body">
        <h2 className={styles.title}>{doc.title}</h2>
        {doc.intro && <p>{doc.intro}</p>}
        {doc.sections.map((s) => (
          <section key={s.title}>
            <h3 className={styles.section}>{s.title}</h3>
            {s.lines.some((l) => l.startsWith("- ")) ? (
              <ul>
                {s.lines.map((l) => (
                  <li key={l}>{withContact(l.replace(/^- /, ""))}</li>
                ))}
              </ul>
            ) : (
              s.lines.map((l) => <p key={l}>{withContact(l)}</p>)
            )}
          </section>
        ))}
        {doc.footer && <p className={styles.footer}>{doc.footer}</p>}
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={closeTerms} autoFocus data-testid="terms-close">
          {A.close}
        </button>
      </div>
    </dialog>
  );
}
