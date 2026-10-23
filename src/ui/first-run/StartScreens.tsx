// 시작할 때 일지를 열 수 없는 경우의 화면: 저장 폴더 없음 / 데이터 파일 이상(data-spec 7-3).
import { classifyFolder } from "../../data/session";
import { BACKUP_DIR } from "../../data/backup";
import { STR } from "../../shared/strings";
import { goFirstRun, openAt, openFolderAsJournal } from "../common/appController";
import { useAppStore } from "../common/appStore";
import styles from "./FirstRun.module.css";

export function MissingFolder({ dataDir }: { dataDir: string }) {
  const platform = useAppStore((s) => s.platform)!;
  return (
    <div className={styles.wrap}>
      <section className={styles.card} role="alert">
        <h1 className={styles.title}>{STR.missing.title}</h1>
        <p className={styles.lead}>{STR.missing.body(dataDir)}</p>
        <div className={styles.stack}>
          <button type="button" className={styles.primary} onClick={() => void openAt(dataDir)} autoFocus>
            {STR.missing.retry}
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={async () => {
              const p = await platform.pickFolder(STR.firstRun.pickTitle);
              if (p && (await classifyFolder(platform, null, p)) === "has-journal")
                await openFolderAsJournal(p);
            }}
          >
            {STR.missing.openOther}
          </button>
          <button type="button" className={styles.link} onClick={goFirstRun}>
            {STR.missing.startNew}
          </button>
        </div>
      </section>
    </div>
  );
}

export function IntegrityProblem({ dataDir, path }: { dataDir: string; path: string }) {
  const platform = useAppStore((s) => s.platform)!;
  return (
    <div className={styles.wrap}>
      <section className={styles.card} role="alert">
        <h1 className={styles.title}>{STR.integrity.title}</h1>
        <p className={styles.lead}>{STR.integrity.body(path)}</p>
        <p className={styles.small}>{STR.integrity.guide}</p>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void platform.openFolder(platform.join(dataDir, BACKUP_DIR))}
          >
            {STR.integrity.openBackups}
          </button>
          <button type="button" className={styles.primary} onClick={() => void openAt(dataDir)}>
            {STR.integrity.retry}
          </button>
        </div>
      </section>
    </div>
  );
}
