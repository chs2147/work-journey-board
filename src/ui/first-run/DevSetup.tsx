// DEV 검증판 일지 선택(docs/release-channel-spec.md 4절) — 설치(판)마다 묻는다.
// 빈 일지(기본) · 가상 샘플 · 정식 일지 복제(원본은 읽기만). 정식 일지 폴더는 DEV 일지 폴더로 쓸 수 없다.
import { useEffect, useState } from "react";
import { seedSample, type SampleData } from "../../data/seed";
import { openJournalAt } from "../../data/session";
import { STR } from "../../shared/strings";
import { finishDevSetup, goDevSetup, openAt, openFolderAsJournal } from "../common/appController";
import { useAppStore } from "../common/appStore";
import styles from "./FirstRun.module.css";

type Option = "empty" | "sample" | "copy";
const D = STR.devChannel;

export function DevSetup() {
  const platform = useAppStore((s) => s.platform)!;
  const [option, setOption] = useState<Option>("empty");
  const [dest, setDest] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [prev, setPrev] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setDest(`${await platform.suggestedDataDir()} DEV`);
      const c = await platform.loadConfig();
      if (c?.dataDir && (await platform.dev?.folderStatus(c.dataDir)) === "dev") setPrev(c.dataDir);
    })();
  }, [platform]);

  const done = async (ok: boolean) => {
    if (ok) await finishDevSetup();
  };

  const start = async () => {
    const dev = platform.dev;
    if (!dev || !dest) return;
    setBusy(true);
    setError(null);
    try {
      const status = await dev.folderStatus(dest);
      if (status === "official") return setError(D.errOfficialDest);
      if (status === "dev") return setError(D.errDevDest);
      if (option === "copy") {
        if (!src || (await dev.folderStatus(src)) !== "official") return setError(D.errNotOfficial);
        await dev.copyOfficial(src, dest);
      } else {
        await platform.ensureDir(dest);
        if (option === "sample") {
          // 가상 샘플(fixtures, 실제 업무 기록 아님)을 새 DEV 일지에 넣고 닫은 뒤 연다
          const driver = await openJournalAt(platform, dest, () => platform.now());
          const sample = (await import("../../../fixtures/sample-showcase.json")).default as SampleData;
          await seedSample(driver, sample);
          await driver.close();
        }
      }
      await done(await openFolderAsJournal(dest));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === "SOURCE_IN_USE" ? D.errInUse : D.errFailed(msg));
      if (useAppStore.getState().journal.state !== "dev-setup") goDevSetup();
    } finally {
      setBusy(false);
    }
  };

  const pick = async (title: string, set: (p: string) => void) => {
    const p = await platform.pickFolder(title);
    if (p) set(p);
  };

  return (
    <div className={styles.wrap}>
      <section className={styles.card} data-testid="dev-setup">
        <h1 className={styles.title}>{D.setupTitle}</h1>
        <p className={styles.lead}>{D.setupLead}</p>
        <div className={styles.stack} role="radiogroup" aria-label={D.setupTitle}>
          {(
            [
              ["empty", D.optEmpty],
              ["sample", D.optSample],
              ["copy", D.optCopy],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className={styles.row} title={key === "copy" ? D.optCopyHint : undefined}>
              <input
                type="radio"
                name="dev-journal"
                value={key}
                checked={option === key}
                onChange={() => setOption(key)}
                data-testid={`dev-opt-${key}`}
              />
              {label}
            </label>
          ))}
        </div>
        <dl className={styles.facts}>
          <dt>{D.devFolder}</dt>
          <dd data-testid="dev-dest">{dest ?? D.notPicked}</dd>
          {option === "copy" && (
            <>
              <dt>{D.officialFolder}</dt>
              <dd data-testid="dev-src">{src ?? D.notPicked}</dd>
            </>
          )}
        </dl>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void pick(D.pickDevTitle, setDest)}
          >
            {D.devFolder} · {D.pick}
          </button>
          {option === "copy" && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void pick(D.pickOfficialTitle, setSrc)}
              data-testid="dev-pick-src"
            >
              {D.officialFolder} · {D.pick}
            </button>
          )}
        </div>
        <button
          type="button"
          className={styles.primary}
          disabled={busy || !dest || (option === "copy" && !src)}
          onClick={() => void start()}
          data-testid="dev-start"
        >
          {busy ? D.starting : D.start}
        </button>
        {prev && (
          <button
            type="button"
            className={styles.link}
            disabled={busy}
            onClick={() => void openAt(prev).then(done)}
            data-testid="dev-continue"
          >
            {D.continuePrev}
          </button>
        )}
        {error && (
          <p className={styles.warnText} role="alert" data-testid="dev-error">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

export function DevOfficialRefused({ dataDir }: { dataDir: string }) {
  return (
    <div className={styles.wrap}>
      <section className={`${styles.card} ${styles.incompatible}`} role="alert" data-testid="dev-official">
        <h1 className={styles.title}>{D.officialTitle}</h1>
        <p className={styles.lead}>{D.officialBody}</p>
        <dl className={styles.facts}>
          <dt>{STR.incompatible.folder}</dt>
          <dd>{dataDir}</dd>
        </dl>
        <button type="button" className={styles.primary} autoFocus onClick={() => goDevSetup()}>
          {D.backToSetup}
        </button>
      </section>
    </div>
  );
}
