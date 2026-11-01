// 설정 › 업데이트·정보 › 정보 카드의 "만든 이"(release-phase2-spec 5절 B2): sanbonjini M1 로고(높이 40px — 브랜드 최소 크기)
// + 메시지·Copyright + [브랜드 사이트 ↗]. 로고는 공식 SVG를 앱 안에 함께 넣은 것(외부 이미지 없음),
// 사이트는 OS 기본 브라우저에 주소만 넘긴다(링크 열기 규칙 — 앱은 접속하지 않음). 어두운 테마는 리버스 로고.
import m1Color from "../../shared/brand/sanbonjini/m1-en-color.svg";
import m1Reverse from "../../shared/brand/sanbonjini/m1-en-reverse.svg";
import { resolveTheme } from "../../shared/theme";
import { STR } from "../../shared/strings";
import { useAppStore } from "../common/appStore";
import styles from "./Settings.module.css";

export function MakerRow() {
  const platform = useAppStore((s) => s.platform);
  const theme = useAppStore((s) => s.theme);
  const dark = resolveTheme(theme) === "dark";
  return (
    <div className={styles.setRow} data-testid="maker-row">
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{STR.settings.makerLabel}</span>
        <img className={styles.makerLogo} src={dark ? m1Reverse : m1Color} alt="sanbonjini" height={40} />
        <span className={styles.rowDesc}>{STR.settings.makerLine}</span>
      </div>
      <div className={styles.rowCtl}>
        <button type="button" onClick={() => void platform?.openUrl(STR.settings.makerSiteUrl)}>
          {STR.settings.makerSite} <span aria-hidden="true">↗</span>
        </button>
      </div>
    </div>
  );
}
