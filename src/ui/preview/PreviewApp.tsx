// Connected Preview 시작 화면(V2 6-B, docs/v2-design/78-preview-native-bootstrap.md).
// 기존 앱 시작 흐름(appController.start — 설정 읽기·첫 실행·일지 열기·새 판 확인)을 부르지 않는다.
// 로그인·온라인 공간 화면(A안)은 다음 단계에서 이 자리에 붙는다.
import { useEffect } from "react";
import { loadSplash, type AppProfileInfo } from "../../platform";
import { STR } from "../../shared/strings";
import { applyTheme, readStoredTheme } from "../../shared/theme";
import { finishSplash } from "../splash";
import appStyles from "../App.module.css";
import styles from "../first-run/FirstRun.module.css";

export function PreviewApp({ profile }: { profile: AppProfileInfo }) {
  useEffect(() => {
    applyTheme(readStoredTheme());
    document.title = profile.productName;
    void loadSplash().then((splash) => finishSplash({ splash }));
  }, [profile.productName]);
  const P = STR.connectedPreview;
  return (
    <div className={appStyles.shell}>
      <div className={styles.wrap} data-testid="connected-preview">
        <section className={styles.card}>
          <h1 className={styles.title}>{profile.productName}</h1>
          <p className={styles.lead}>{P.lead}</p>
          <dl className={styles.facts}>
            <dt>{P.profile}</dt>
            <dd>{P.profileValue}</dd>
            <dt>{P.appVersion}</dt>
            <dd>{__APP_VERSION__}</dd>
            <dt>{P.updates}</dt>
            <dd data-testid="preview-updates">{P.updatesOff}</dd>
            <dt>{P.localJournal}</dt>
            <dd data-testid="preview-local-journal">{P.localJournalOff}</dd>
            <dt>{P.online}</dt>
            <dd>{P.onlinePending}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
