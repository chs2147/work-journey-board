// 설정 › 화면 › 테마(improve-1027v5-spec 4-1): 시스템 설정 / 라이트 / 다크 미리보기 카드 — 고르면 바로 적용.
import { useEffect, useState } from "react";
import { STR } from "../../shared/strings";
import { systemTheme, THEME_PREFS, type ThemePref } from "../../shared/theme";
import { setTheme } from "../common/appController";
import { useAppStore } from "../common/appStore";
import { Card } from "./SettingsCard";
import styles from "./Settings.module.css";

/** 미리보기 한 장(앱 모양을 줄인 그림) — 색은 고정값(테마와 관계없이 그 테마의 모습) */
function Thumb({ kind }: { kind: "light" | "dark" }) {
  return (
    <span className={`${styles.thumbHalf} ${kind === "dark" ? styles.thumbDark : styles.thumbLight}`}>
      <span className={styles.thumbBar} />
      <span className={styles.thumbBody}>
        <span className={styles.thumbRail} />
        <span className={styles.thumbCells}>
          <span />
          <span className={styles.thumbAccent} />
          <span />
          <span />
          <span className={styles.thumbMark} />
          <span />
        </span>
      </span>
    </span>
  );
}

function useSystemDark() {
  const [dark, setDark] = useState(() => systemTheme() === "dark");
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = () => setDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

export function ThemeSettings() {
  const theme = useAppStore((s) => s.theme);
  const sysDark = useSystemDark();
  const desc: Record<ThemePref, string> = {
    system: STR.settings.themeNow(sysDark),
    light: STR.settings.themeLight,
    dark: STR.settings.themeDark,
  };
  return (
    <Card id="s-theme" title={STR.settings.theme} desc={STR.settings.themeDesc} testId="theme-settings">
      <div className={styles.themeGrid} role="radiogroup" aria-labelledby="s-theme">
        {THEME_PREFS.map((pref) => (
          <label key={pref} className={`${styles.themeOpt} ${theme === pref ? styles.themeOn : ""}`}>
            <span className={styles.thumb} aria-hidden="true">
              {pref === "system" ? (
                <>
                  <Thumb kind="light" />
                  <Thumb kind="dark" />
                </>
              ) : (
                <Thumb kind={pref} />
              )}
            </span>
            <span className={styles.themeName}>
              <input
                type="radio"
                name="theme"
                value={pref}
                checked={theme === pref}
                aria-label={STR.settings.themeNames[pref]}
                aria-describedby={`theme-desc-${pref}`}
                onChange={() => void setTheme(pref)}
              />
              <b>{STR.settings.themeNames[pref]}</b>
              {pref === "system" && <span className={styles.badge}>{STR.settings.themeDefault}</span>}
            </span>
            <span className={styles.rowDesc} id={`theme-desc-${pref}`}>
              {desc[pref]}
            </span>
          </label>
        ))}
      </div>
      <p className={styles.infoNote}>{STR.settings.themeNote}</p>
    </Card>
  );
}
