// 설정(overview 10-9·10-10): 저장 위치 · 백업 · 종료된 업무 · 무기록 종료 제안 · 정보.
import { useCallback, useEffect, useRef, useState } from "react";
import { openPeriod } from "../../domain/categories";
import type { Category } from "../../domain/types";
import { BACKUP_DIR } from "../../data/backup";
import { classifyFolder, journalPath, lastBackupOf, manualBackup, type BackupInfo } from "../../data/session";
import type { Settings } from "../../data/settings";
import { STR } from "../../shared/strings";
import { reload, toast } from "../board/boardStore";
import { moveTo, setSettingsOpen, switchTo } from "../common/appController";
import { useAppStore } from "../common/appStore";
import styles from "./Settings.module.css";

type Pending =
  | { kind: "same" }
  | { kind: "onedrive"; dir: string }
  | { kind: "has-journal"; dir: string }
  | { kind: "empty"; dir: string }
  | { kind: "moving" }
  | { kind: "done"; message: string; oldDir: string }
  | { kind: "failed"; message: string };

const NUDGE_OPTIONS = [0, 2, 3, 4, 5, 6, 7, 8];

function close() {
  setSettingsOpen(false);
  void reload();
}

export function SettingsPanel() {
  const platform = useAppStore((s) => s.platform)!;
  const journal = useAppStore((s) => s.journal);
  const ready = journal.state === "ready" ? journal : null;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [last, setLast] = useState<BackupInfo | null>(null);
  const [archived, setArchived] = useState<{ category: Category; endDate: string }[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [copyBackups, setCopyBackups] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!ready) return;
    setSettings(await ready.repo.getSettings());
    setSize((await platform.stat(journalPath(platform, ready.dataDir))).size);
    setLast(await lastBackupOf(platform, ready.dataDir));
    const { categories, periods } = await ready.repo.listCategories();
    setArchived(
      categories
        .map((category) => {
          const ps = periods.filter((p) => p.categoryId === category.id);
          if (openPeriod(ps)) return null;
          const endDate =
            ps
              .map((p) => p.endDate ?? "")
              .sort()
              .at(-1) ?? "";
          return { category, endDate };
        })
        .filter((x): x is { category: Category; endDate: string } => x !== null),
    );
  }, [ready, platform]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 설정 화면을 열 때 저장소에서 한 번 읽어 온다
    void refresh();
  }, [refresh]);

  useEffect(() => {
    panelRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);

  if (!ready) return null;

  const pickLocation = async () => {
    setPending(null);
    const dir = await platform.pickFolder(STR.settings.pickTitle);
    if (!dir) return;
    const kind = await classifyFolder(platform, ready.dataDir, dir);
    if (kind === "same") return setPending({ kind: "same" });
    if (await platform.isOneDrivePath(dir)) return setPending({ kind: "onedrive", dir });
    setPending({ kind, dir });
  };

  const afterOneDrive = async (dir: string) => {
    const kind = await classifyFolder(platform, ready.dataDir, dir);
    setPending(kind === "same" ? { kind: "same" } : { kind, dir });
  };

  const doMove = async (dir: string) => {
    const oldDir = ready.dataDir;
    setPending({ kind: "moving" });
    const err = await moveTo(dir, copyBackups);
    setPending(
      err
        ? { kind: "failed", message: STR.settings.failed(err) }
        : { kind: "done", message: STR.settings.moved, oldDir },
    );
  };

  const doSwitch = async (dir: string) => {
    const oldDir = ready.dataDir;
    setPending({ kind: "moving" });
    const err = await switchTo(dir);
    setPending(
      err
        ? { kind: "failed", message: STR.settings.failed(err) }
        : { kind: "done", message: STR.settings.switched, oldDir },
    );
  };

  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <header className={styles.head}>
          <h2 id="settings-title">{STR.settings.title}</h2>
          <button
            type="button"
            className={styles.close}
            aria-label={STR.settings.close}
            title={STR.settings.close}
            onClick={close}
          >
            ✕
          </button>
        </header>

        <section className={styles.section} aria-labelledby="s-location">
          <h3 id="s-location">{STR.settings.location}</h3>
          <code className={styles.path} data-testid="settings-data-dir">
            {ready.dataDir}
          </code>
          {size !== null && <p className={styles.note}>{STR.settings.fileSize((size / 1024).toFixed(1))}</p>}
          <div className={styles.row}>
            <button type="button" onClick={() => void platform.openFolder(ready.dataDir)}>
              {STR.settings.openFolder}
            </button>
            <button type="button" onClick={() => void pickLocation()} disabled={pending?.kind === "moving"}>
              {STR.settings.change}
            </button>
          </div>
          {pending && (
            <div className={styles.flow} role="status" data-testid="location-flow">
              {pending.kind === "same" && <p>{STR.settings.same}</p>}
              {pending.kind === "onedrive" && (
                <>
                  <strong>{STR.firstRun.oneDriveTitle}</strong>
                  <p>{STR.firstRun.oneDriveBody}</p>
                  <div className={styles.row}>
                    <button type="button" onClick={() => void pickLocation()}>
                      {STR.firstRun.browse}
                    </button>
                    <button type="button" onClick={() => void afterOneDrive(pending.dir)}>
                      {STR.firstRun.useAnyway}
                    </button>
                  </div>
                </>
              )}
              {pending.kind === "has-journal" && (
                <>
                  <p>{STR.settings.otherJournal}</p>
                  <code className={styles.path}>{pending.dir}</code>
                  <div className={styles.row}>
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={() => void doSwitch(pending.dir)}
                    >
                      {STR.settings.switchTo}
                    </button>
                    <button type="button" onClick={() => setPending(null)}>
                      {STR.settings.cancel}
                    </button>
                  </div>
                </>
              )}
              {pending.kind === "empty" && (
                <>
                  <p>{STR.settings.moveConfirm(pending.dir)}</p>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={copyBackups}
                      onChange={(e) => setCopyBackups(e.target.checked)}
                    />
                    {STR.settings.copyBackups}
                  </label>
                  <div className={styles.row}>
                    <button type="button" className={styles.primary} onClick={() => void doMove(pending.dir)}>
                      {STR.settings.move}
                    </button>
                    <button type="button" onClick={() => setPending(null)}>
                      {STR.settings.cancel}
                    </button>
                  </div>
                </>
              )}
              {pending.kind === "moving" && <p>{STR.settings.moving}</p>}
              {pending.kind === "done" && (
                <>
                  <p>{pending.message}</p>
                  <div className={styles.row}>
                    <button type="button" onClick={() => void platform.openFolder(pending.oldDir)}>
                      {STR.settings.openOld}
                    </button>
                  </div>
                </>
              )}
              {pending.kind === "failed" && <p className={styles.error}>{pending.message}</p>}
            </div>
          )}
        </section>

        <section className={styles.section} aria-labelledby="s-backup">
          <h3 id="s-backup">{STR.settings.backup}</h3>
          <p data-testid="last-backup">{last ? STR.settings.lastBackup(last.when) : STR.settings.noBackup}</p>
          {settings && (
            <p className={styles.note}>
              {STR.settings.backupPolicy(settings.backup.dailyKeep, settings.backup.monthlyKeep)}
            </p>
          )}
          <div className={styles.row}>
            <button
              type="button"
              onClick={async () => {
                try {
                  await manualBackup(platform, ready.driver, ready.dataDir, platform.now());
                  toast(STR.settings.backupDone);
                } catch (e) {
                  toast(STR.toast.error(e instanceof Error ? e.message : String(e)));
                }
                await refresh();
              }}
            >
              {STR.settings.backupNow}
            </button>
            <button
              type="button"
              onClick={() => void platform.openFolder(platform.join(ready.dataDir, BACKUP_DIR))}
            >
              {STR.settings.openBackups}
            </button>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="s-cats">
          <h3 id="s-cats">{STR.settings.categories}</h3>
          {archived.length === 0 ? (
            <p className={styles.note}>{STR.settings.noArchived}</p>
          ) : (
            <ul className={styles.list}>
              {archived.map(({ category, endDate }) => (
                <li key={category.id}>
                  <span className={styles.dot} style={{ background: `var(--cat-${category.color})` }} />
                  <span className={styles.grow}>{category.name}</span>
                  <span className={styles.note}>{STR.settings.endedOn(endDate)}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      await ready.repo.reactivateCategory(category.id);
                      toast(STR.settings.reactivated(category.name));
                      await refresh();
                    }}
                  >
                    {STR.settings.reactivate}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby="s-nudge">
          <h3 id="s-nudge">{STR.settings.nudge}</h3>
          <label className={styles.row}>
            <span>{STR.settings.nudgeLabel}</span>
            <select
              value={settings?.nudgeWeeks ?? 3}
              onChange={async (e) => {
                setSettings(await ready.repo.updateSettings({ nudgeWeeks: Number(e.target.value) }));
              }}
            >
              {NUDGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? STR.settings.nudgeOff : STR.settings.nudgeWeeks(n)}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className={styles.section} aria-labelledby="s-about">
          <h3 id="s-about">{STR.settings.about}</h3>
          <p className={styles.note}>
            {STR.appName} · {STR.settings.version(__APP_VERSION__)}
          </p>
        </section>
      </div>
    </div>
  );
}
