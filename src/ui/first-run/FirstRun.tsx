// 첫 실행 3단계(overview 10-8, 와이어프레임 wireframe-first-run.svg): 시작 → 저장 폴더(OneDrive 경고) → 첫 업무.
import { useEffect, useState } from "react";
import { classifyFolder } from "../../data/session";
import { CATEGORY_COLOR_KEYS } from "../../shared/palette";
import { STR } from "../../shared/strings";
import { addCategory, goToday } from "../board/boardStore";
import { isComposingKey } from "../board/helpers";
import { openFolderAsJournal } from "../common/appController";
import { useAppStore } from "../common/appStore";
import styles from "./FirstRun.module.css";

type Step = "welcome" | "folder" | "categories";

export function FirstRun() {
  const platform = useAppStore((s) => s.platform)!;
  const [step, setStep] = useState<Step>("welcome");
  const [suggested, setSuggested] = useState("");
  const [dir, setDir] = useState("");
  const [oneDrive, setOneDrive] = useState(false);
  const [found, setFound] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void platform.suggestedDataDir().then((p) => {
      setSuggested(p);
      setDir((d) => d || p);
    });
  }, [platform]);

  const inspect = async (path: string) => {
    setDir(path);
    setNotice(null);
    setOneDrive(await platform.isOneDrivePath(path));
    setFound((await classifyFolder(platform, null, path)) === "has-journal");
  };

  const browse = async () => {
    const p = await platform.pickFolder(STR.firstRun.pickTitle);
    if (p) await inspect(p);
  };

  const openExisting = async () => {
    const p = await platform.pickFolder(STR.firstRun.pickTitle);
    if (!p) return;
    if ((await classifyFolder(platform, null, p)) !== "has-journal") return setNotice(STR.firstRun.noJournal);
    setBusy(true);
    if (!(await openFolderAsJournal(p))) setBusy(false);
  };

  const finish = async (withNames: string[]) => {
    setBusy(true);
    if (!(await openFolderAsJournal(dir))) return setBusy(false);
    for (const n of withNames) await addCategory(n);
    await goToday();
  };

  return (
    <div className={styles.wrap}>
      {step === "welcome" && (
        <section className={styles.card} aria-labelledby="fr-title">
          <h1 id="fr-title" className={styles.title}>
            {STR.firstRun.welcomeTitle}
          </h1>
          <p className={styles.lead}>{STR.firstRun.welcomeLead}</p>
          <div className={styles.ok}>
            <p>{STR.firstRun.privacy}</p>
            <p className={styles.small}>{STR.firstRun.privacyNote}</p>
          </div>
          {notice && <p className={styles.warnText}>{notice}</p>}
          <div className={styles.stack}>
            <button type="button" className={styles.primary} onClick={() => setStep("folder")} autoFocus>
              {STR.firstRun.startNew}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => void openExisting()}
            >
              {STR.firstRun.openExisting}
            </button>
          </div>
        </section>
      )}

      {step === "folder" && (
        <section className={styles.card} aria-labelledby="fr-folder">
          <h1 id="fr-folder" className={styles.title}>
            {STR.firstRun.folderTitle}
          </h1>
          <p className={styles.lead}>{STR.firstRun.folderLead}</p>
          <div className={styles.pathRow}>
            <code className={styles.path} data-testid="first-run-path">
              {dir}
            </code>
            <button type="button" className={styles.secondary} onClick={() => void browse()}>
              {STR.firstRun.browse}
            </button>
          </div>
          {oneDrive && (
            <div className={styles.warn} role="alert">
              <strong>{STR.firstRun.oneDriveTitle}</strong>
              <p>{STR.firstRun.oneDriveBody}</p>
              <p className={styles.small}>{STR.firstRun.oneDriveSuggest(suggested)}</p>
              <div className={styles.row}>
                <button type="button" className={styles.primary} onClick={() => void inspect(suggested)}>
                  {STR.firstRun.useSuggested}
                </button>
                <button type="button" className={styles.link} onClick={() => setOneDrive(false)}>
                  {STR.firstRun.useAnyway}
                </button>
              </div>
            </div>
          )}
          {found && (
            <div className={styles.ok}>
              <p>{STR.firstRun.foundJournal}</p>
            </div>
          )}
          <div className={styles.footer}>
            <button type="button" className={styles.secondary} onClick={() => setStep("welcome")}>
              {STR.firstRun.back}
            </button>
            {found ? (
              <button
                type="button"
                className={styles.primary}
                disabled={busy || oneDrive}
                onClick={() => void finish([])}
              >
                {STR.firstRun.openFound}
              </button>
            ) : (
              <button
                type="button"
                className={styles.primary}
                disabled={!dir || oneDrive}
                onClick={() => setStep("categories")}
              >
                {STR.firstRun.next}
              </button>
            )}
          </div>
        </section>
      )}

      {step === "categories" && (
        <section className={styles.card} aria-labelledby="fr-cats">
          <h1 id="fr-cats" className={styles.title}>
            {STR.firstRun.categoriesTitle}
          </h1>
          <p className={styles.lead}>{STR.firstRun.categoriesLead}</p>
          <ul className={styles.chips}>
            {names.map((n, i) => (
              <li key={n} className={styles.chip}>
                <span
                  className={styles.dot}
                  style={{ background: `var(--cat-${CATEGORY_COLOR_KEYS[i % CATEGORY_COLOR_KEYS.length]})` }}
                />
                <span>{n}</span>
                <button
                  type="button"
                  aria-label={STR.firstRun.removeCategory(n)}
                  title={STR.firstRun.removeCategory(n)}
                  onClick={() => setNames(names.filter((x) => x !== n))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <input
            className={styles.input}
            placeholder={STR.firstRun.categoryPlaceholder}
            aria-label={STR.firstRun.categoryPlaceholder}
            maxLength={40}
            autoFocus
            onKeyDown={(e) => {
              if (isComposingKey(e) || e.key !== "Enter") return;
              const v = e.currentTarget.value.trim().replace(/\s+/g, " ");
              if (v && !names.includes(v)) setNames([...names, v]);
              e.currentTarget.value = "";
            }}
          />
          <p className={styles.small}>{STR.firstRun.colorAuto}</p>
          <div className={styles.footer}>
            <button type="button" className={styles.link} disabled={busy} onClick={() => void finish([])}>
              {STR.firstRun.skip}
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => void finish(names)}
            >
              {busy ? STR.firstRun.opening : STR.firstRun.openBoard}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
