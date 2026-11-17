// G-5(docs/v2-design/100) 되돌릴 수 없는 지우기 확인 — 로그아웃 확인과 같은 자리·모양(설정 행 여백·선).
// 정해진 글(공간 이름·이메일)을 그대로 입력해야 [삭제]가 눌린다.
import { useState } from "react";
import { STR } from "../../shared/strings";
import settings from "../settings/Settings.module.css";
import own from "./AccountPanel.module.css";

export function DeleteConfirm({
  title,
  body,
  expect,
  okLabel,
  onCancel,
  onConfirm,
  testId,
}: {
  title: string;
  body: string;
  /** 이 글을 그대로 입력해야 한다(앞뒤 공백 무시) */
  expect: string;
  okLabel: string;
  onCancel: () => void;
  /** 오류 글이면 그 글을 보이고 그대로 둔다 */
  onConfirm: () => Promise<string | null | void>;
  testId: string;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const match = typed.trim() === expect.trim() && expect.trim() !== "";
  return (
    <div className={own.confirm} role="alertdialog" aria-label={title} data-testid={testId}>
      <span className={settings.rowText}>
        <span className={settings.rowLabel}>{title}</span>
        <span className={settings.rowDesc}>{body}</span>
        {error && (
          <span className={own.error} role="alert" data-testid={`${testId}-error`}>
            {error}
          </span>
        )}
      </span>
      <span className={own.confirmButtons}>
        <input
          className={own.input}
          aria-label={STR.onlineSpaces.account.confirmPlaceholder}
          placeholder={expect}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          data-testid={`${testId}-input`}
        />
        <button type="button" disabled={busy} onClick={onCancel}>
          {STR.workspace.cancel}
        </button>
        <button
          type="button"
          className={settings.danger}
          disabled={!match || busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void onConfirm()
              .then((e) => {
                if (e) setError(e);
              })
              .finally(() => setBusy(false));
          }}
          data-testid={`${testId}-ok`}
        >
          {okLabel}
        </button>
      </span>
    </div>
  );
}
