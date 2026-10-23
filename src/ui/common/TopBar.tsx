import { STR } from "../../shared/strings";
import styles from "./TopBar.module.css";

export function TopBar() {
  return (
    <header className={styles.bar}>
      <span className={styles.title}>{STR.appName}</span>
      <div className={styles.spacer} />
      <button
        type="button"
        className={styles.iconButton}
        aria-label={STR.topBar.settings}
        title={STR.topBar.settingsPending}
        disabled
      >
        ⚙
      </button>
    </header>
  );
}
