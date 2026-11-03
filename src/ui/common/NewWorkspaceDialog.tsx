// 새 워크스페이스 만들기 4단계(multi-board-spec 4절): 이름·색·아이콘·용도 → 저장 위치 → 첫 업무 → 지금 공간에서 가져올 설정.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PURPOSES,
  PURPOSE_PRESET,
  QUIET_PURPOSES,
  cleanName,
  nextWorkspaceColor,
  sameDir,
  suggestDir,
  type WorkspaceIcon,
  type WorkspacePurpose,
} from "../../domain/workspace";
import { classifyFolder } from "../../data/session";
import { CATEGORY_COLOR_KEYS, type CategoryColorKey } from "../../shared/palette";
import { STR } from "../../shared/strings";
import { handleEnterCommit } from "../board/helpers";
import { createWorkspace } from "./appController";
import { useAppStore } from "./appStore";
import { WorkspaceLook } from "./WorkspaceFields";
import styles from "./NewWorkspaceDialog.module.css";

type Step = 1 | 2 | 3 | 4;

export function NewWorkspaceDialog() {
  const platform = useAppStore((s) => s.platform)!;
  const list = useAppStore((s) => s.workspaces);
  const currentDir = useAppStore((s) => (s.journal.state === "ready" ? s.journal.dataDir : ""));
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [color, setColor] = useState<CategoryColorKey>(() => nextWorkspaceColor(list));
  const [purpose, setPurpose] = useState<WorkspacePurpose>("life");
  const [icon, setIcon] = useState<WorkspaceIcon>(PURPOSE_PRESET.life.icon);
  const [iconTouched, setIconTouched] = useState(false);
  const [otherDir, setOtherDir] = useState<string | null>(null);
  const [folderInfo, setFolderInfo] = useState<{ oneDrive: boolean; journal: boolean }>({
    oneDrive: false,
    journal: false,
  });
  const [cats, setCats] = useState<string[]>(PURPOSE_PRESET.life.categories);
  const [copy, setCopy] = useState({ holiday: true, tags: false, nudge: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const catRef = useRef<HTMLInputElement>(null);
  const close = () => useAppStore.setState({ creatingWorkspace: false });

  const label = STR.workspace.purposes[purpose];
  const suggested = useMemo(
    () =>
      suggestDir(
        currentDir || list[0]?.dir || "/WorkJourney",
        cleanName(name) || label,
        list.map((e) => e.dir),
      ),
    [currentDir, list, name, label],
  );
  const dir = otherDir ?? suggested;
  const taken = list.some((e) => sameDir(e.dir, dir));

  useEffect(() => {
    if (step !== 2) return;
    let alive = true;
    void (async () => {
      const oneDrive = await platform.isOneDrivePath(dir).catch(() => false);
      const journal = (await classifyFolder(platform, null, dir).catch(() => "empty")) === "has-journal";
      if (alive) setFolderInfo({ oneDrive, journal });
    })();
    return () => {
      alive = false;
    };
  }, [platform, dir, step]);

  const choosePurpose = (p: WorkspacePurpose) => {
    setPurpose(p);
    setCats(PURPOSE_PRESET[p].categories);
    if (!iconTouched) setIcon(PURPOSE_PRESET[p].icon);
  };

  const pick = async () => {
    const p = await platform.pickFolder(STR.workspace.pickTitle);
    if (p) setOtherDir(p);
  };

  const finish = async () => {
    const pending = catRef.current ? cleanName(catRef.current.value) : "";
    const categories = pending && !cats.includes(pending) ? [...cats, pending] : cats;
    setBusy(true);
    setError(null);
    const err = await createWorkspace({ name, color, icon, purpose, dir, categories, copy });
    if (err) {
      setError(err);
      setBusy(false);
    }
  };

  const nameOk = !!cleanName(name);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !busy) {
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className={styles.backdrop} onKeyDown={onKey}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ws-new-title"
        data-testid="new-workspace"
      >
        <header className={styles.head}>
          <h2 id="ws-new-title">{STR.workspace.newTitle}</h2>
          <span className={styles.step} data-testid="ws-step">
            {STR.workspace.step(step)}
          </span>
        </header>

        {step === 1 && (
          <div className={styles.body}>
            <h3>{STR.workspace.stepBasic}</h3>
            <WorkspaceLook
              name={name}
              color={color}
              icon={icon}
              autoFocus
              onName={setName}
              onColor={setColor}
              onIcon={(i) => {
                setIcon(i);
                setIconTouched(true);
              }}
            />
            <span className={styles.label}>{STR.workspace.purposeLabel}</span>
            <div className={styles.chips} role="radiogroup" aria-label={STR.workspace.purposeLabel}>
              {PURPOSES.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={p === purpose}
                  className={`${styles.chip} ${p === purpose ? styles.chipOn : ""}`}
                  data-purpose={p}
                  onClick={() => choosePurpose(p)}
                >
                  {STR.workspace.purposes[p]}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className={styles.body}>
            <h3>{STR.workspace.stepFolder}</h3>
            <label className={`${styles.radio} ${otherDir === null ? styles.radioOn : ""}`}>
              <input type="radio" checked={otherDir === null} onChange={() => setOtherDir(null)} />
              <span>
                <b>{STR.workspace.folderSuggested}</b>
                <code className={styles.path} data-testid="ws-dir">
                  {suggested}
                </code>
              </span>
            </label>
            <label className={`${styles.radio} ${otherDir !== null ? styles.radioOn : ""}`}>
              <input type="radio" checked={otherDir !== null} onChange={() => void pick()} />
              <span>
                <b>{STR.workspace.folderOther}</b>
                {otherDir && <code className={styles.path}>{otherDir}</code>}
              </span>
            </label>
            <p className={styles.note}>{STR.workspace.folderNote}</p>
            {taken && <p className={styles.warn}>{STR.workspace.folderTaken}</p>}
            {!taken && folderInfo.journal && <p className={styles.ok}>{STR.workspace.folderHasJournal}</p>}
            {folderInfo.oneDrive && <p className={styles.warn}>{STR.workspace.folderOneDrive}</p>}
          </div>
        )}

        {step === 3 && (
          <div className={styles.body}>
            <h3>{STR.workspace.stepCategories}</h3>
            <p className={styles.note}>{STR.workspace.categoriesLead(label)}</p>
            <ul className={styles.cats}>
              {cats.map((c, i) => (
                <li key={c} className={styles.cat}>
                  <span
                    className={styles.dot}
                    style={{
                      background: `var(--cat-${CATEGORY_COLOR_KEYS[i % CATEGORY_COLOR_KEYS.length]})`,
                    }}
                  />
                  <span>{c}</span>
                  <button
                    type="button"
                    aria-label={STR.firstRun.removeCategory(c)}
                    title={STR.firstRun.removeCategory(c)}
                    onClick={() => setCats(cats.filter((x) => x !== c))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <input
              ref={catRef}
              className={styles.input}
              placeholder={STR.workspace.categoryAdd}
              aria-label={STR.workspace.categoryAdd}
              maxLength={40}
              autoFocus
              data-testid="ws-cat-input"
              onKeyDown={(e) =>
                void handleEnterCommit(e, (el) => {
                  const v = cleanName(el.value);
                  if (v) setCats((l) => (l.includes(v) ? l : [...l, v]));
                  el.value = "";
                })
              }
            />
          </div>
        )}

        {step === 4 && (
          <div className={styles.body}>
            <h3>{STR.workspace.stepCopy}</h3>
            {(
              [
                ["holiday", STR.workspace.copyHoliday],
                ["tags", STR.workspace.copyTags],
                ["nudge", STR.workspace.copyNudge],
              ] as const
            ).map(([k, text]) => (
              <label key={k} className={styles.check}>
                <input
                  type="checkbox"
                  checked={copy[k]}
                  data-testid={`ws-copy-${k}`}
                  onChange={(e) => setCopy({ ...copy, [k]: e.target.checked })}
                />
                <span>
                  {text}
                  {k === "nudge" && QUIET_PURPOSES.includes(purpose) && (
                    <span className={styles.quiet}> {STR.workspace.copyNudgeQuiet}</span>
                  )}
                </span>
              </label>
            ))}
            <p className={styles.note}>{STR.workspace.copyNote}</p>
          </div>
        )}

        {error && (
          <p className={styles.warn} role="alert">
            {error}
          </p>
        )}
        <footer className={styles.foot}>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => (step === 1 ? close() : setStep((step - 1) as Step))}
          >
            {step === 1 ? STR.workspace.cancel : STR.workspace.back}
          </button>
          {step < 4 && !(step === 2 && folderInfo.journal && !taken) ? (
            <button
              type="button"
              className={styles.primary}
              disabled={(step === 1 && !nameOk) || (step === 2 && taken)}
              data-testid="ws-next"
              onClick={() => setStep((step + 1) as Step)}
            >
              {STR.workspace.next}
            </button>
          ) : (
            <button
              type="button"
              className={styles.primary}
              disabled={busy || taken || !nameOk}
              data-testid="ws-finish"
              onClick={() => void finish()}
            >
              {busy ? STR.workspace.creating : STR.workspace.finish}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
