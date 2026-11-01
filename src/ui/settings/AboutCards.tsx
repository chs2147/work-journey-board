// 설정 › 업데이트·정보 › 정보 + 오픈소스 라이선스(improve-1101 #7). 라이선스 전문은 앱 안에 함께 넣은 글(?raw) — 네트워크 없음.
import { useState } from "react";
import gowunOfl from "../../../public/licenses/GowunDodum-OFL-1.1.txt?raw";
import pretendardOfl from "../../../public/licenses/Pretendard-OFL-1.1.txt?raw";
import { STR } from "../../shared/strings";
import { BrandLockup } from "../common/Brand";
import { useAppStore } from "../common/appStore";
import { MakerRow } from "./MakerRow";
import styles from "./Settings.module.css";
import { Card } from "./SettingsCard";

const O = STR.settings.oss;
/** 함께 넣은 글꼴(CLAUDE.md 4-1) — 저작권 줄은 각 OFL 파일 첫 줄과 같다 */
const FONTS = [
  { name: "Pretendard", ver: "1.3.9", by: "© 2021 Kil Hyung-jin", use: O.useLightDark, text: pretendardOfl },
  {
    name: "고운돋움 (Gowun Dodum)",
    ver: "Regular",
    by: "© 2021 The Gowun Dodum Project Authors",
    use: O.useSignature,
    text: gowunOfl,
  },
];

const LIBS: [string, string, string][] = [
  ["Tauri", "2", "MIT / Apache-2.0"],
  ["React", "18.3", "MIT"],
  ["Tiptap · ProseMirror", "3.32", "MIT"],
  ["SQLite", "3", "Public Domain"],
  ["sql.js", "1.15", "MIT"],
  ["ExcelJS", "4.4", "MIT"],
  ["date-fns", "4.4", "MIT"],
  ["Zustand", "5.0", "MIT"],
];

export function AboutCard() {
  const platform = useAppStore((s) => s.platform);
  return (
    <Card id="s-about" title={STR.settings.about} testId="about-card">
      <div className={styles.aboutHero}>
        <BrandLockup size="hero" />
        <div className={styles.aboutMeta}>
          <span className={styles.aboutVer}>{STR.settings.version(__APP_VERSION__)}</span>
          <span className={styles.rowDesc}>{STR.settings.aboutTagline}</span>
        </div>
        <div className={styles.rowCtl}>
          <button type="button" onClick={() => void platform?.openUrl(STR.settings.siteUrl)}>
            {STR.settings.siteLink} <span aria-hidden="true">↗</span>
          </button>
          <button
            type="button"
            data-testid="about-guide"
            onClick={() => void platform?.openUrl(STR.settings.guideUrl)}
          >
            {STR.settings.guideLink} <span aria-hidden="true">↗</span>
          </button>
          <button
            type="button"
            onClick={() => void platform?.openUrl(STR.settings.notesUrl(__APP_VERSION__))}
          >
            {STR.settings.notesLink} <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
      <MakerRow />
    </Card>
  );
}

export function LicensesCard() {
  const [open, setOpen] = useState<(typeof FONTS)[number] | null>(null);
  return (
    <Card id="s-oss" title={O.title} desc={O.desc} testId="licenses">
      <div className={styles.ossGroup}>
        <h4>{O.fonts}</h4>
        {FONTS.map((f) => (
          <div key={f.name} className={styles.ossFont}>
            <div className={styles.rowText}>
              <span className={styles.rowLabel}>
                {f.name} <span className={styles.ossVer}>{f.ver}</span>
              </span>
              <span className={styles.rowDesc}>
                {f.by} · {O.ofl} · {f.use}
              </span>
            </div>
            <button type="button" onClick={() => setOpen(f)} aria-label={`${f.name} ${O.fullText}`}>
              {O.fullText}
            </button>
          </div>
        ))}
      </div>
      <div className={styles.ossGroup}>
        <h4>{O.libs}</h4>
        <table className={styles.ossTable}>
          <tbody>
            {LIBS.map(([n, v, l]) => (
              <tr key={n}>
                <th scope="row">{n}</th>
                <td>{v}</td>
                <td>{l}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <div className={styles.modalBack} onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label={O.dialogAria(open.name)}>
            <h3>{O.dialogTitle(open.name)}</h3>
            <pre className={styles.ossText}>{open.text}</pre>
            <div className={styles.modalActions}>
              <button type="button" onClick={() => setOpen(null)}>
                {O.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
