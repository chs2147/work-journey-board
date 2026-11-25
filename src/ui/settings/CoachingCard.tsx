// 설정 › 업데이트·정보 › 기능 둘러보기(coaching-spec 5-1, D4) — 코칭 메뉴 열기·처음 설치처럼 다시 보기·화면별 제안 켜기.
import { COACH } from "../../shared/coachingStrings";
import { setSettingsOpen } from "../common/appController";
import { openMenu, replayFirstRun, saveFlags, useCoaching } from "../coaching/coachingStore";
import styles from "./Settings.module.css";
import { Card, Row } from "./SettingsCard";

const S = COACH.settings;

export function CoachingCard() {
  const suggest = useCoaching((s) => s.flags?.suggest ?? true);
  return (
    <Card id="s-coaching" title={S.title} testId="coaching-settings">
      <Row label={S.open}>
        <button
          type="button"
          data-testid="settings-coach-open"
          onClick={() => {
            setSettingsOpen(false);
            openMenu();
          }}
        >
          {S.openBtn}
        </button>
      </Row>
      <Row label={S.replay}>
        <button
          type="button"
          data-testid="settings-coach-replay"
          onClick={() => {
            setSettingsOpen(false);
            void replayFirstRun();
          }}
        >
          {S.replayBtn}
        </button>
      </Row>
      <label className={styles.setRow}>
        <span className={styles.rowText}>
          <span className={styles.rowLabel}>{COACH.menu.suggest}</span>
        </span>
        <input
          type="checkbox"
          checked={suggest}
          data-testid="settings-coach-suggest"
          onChange={(e) => void saveFlags({ suggest: e.target.checked })}
        />
      </label>
    </Card>
  );
}
