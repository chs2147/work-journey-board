import { dismissToast, useBoard } from "../board/boardStore";
import styles from "./Toasts.module.css";

export function Toasts() {
  const toasts = useBoard((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast}>
          <span>{t.message}</span>
          {t.actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => {
                a.run();
                dismissToast(t.id);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
