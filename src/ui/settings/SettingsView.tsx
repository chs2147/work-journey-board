// 설정 화면(improve-1027v5-spec 1절): 보드 자리를 덮는 전체 화면 — 왼쪽 분류 5개, 오른쪽 고른 분류의 카드.
// 기능·문구는 예전 설정 패널(overview 10-9·10-10) 그대로, 자리와 모양만 옮겼다.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { openPeriod } from "../../domain/categories";
import type { Recurrence } from "../../domain/recurrence";
import type { Category } from "../../domain/types";
import { DAY_LABELS, weekIdOf } from "../../domain/week";
import { BACKUP_DIR } from "../../data/backup";
import { classifyFolder, journalPath, lastBackupOf, manualBackup, type BackupInfo } from "../../data/session";
import { SETTINGS_CATEGORIES, type Settings, type SettingsCategory } from "../../data/settings";
import { formatBytes, STR } from "../../shared/strings";
import { toast } from "../board/boardStore";
import { leaveSettings, moveTo, setSettingsOpen, switchTo } from "../common/appController";
import { openImport, undoImportBatch } from "../import/importStore";
import type { ImportBatchInfo } from "../../data/repository";
import { useAppStore } from "../common/appStore";
import { hasUpdate, useUpdate } from "../update/updateStore";
import styles from "./Settings.module.css";
import { Card, Row } from "./SettingsCard";
import { TagSettings } from "./TagSettings";
import { ThemeSettings } from "./ThemeSettings";
import { UpdateSettings } from "../update/UpdateViews";

type Pending =
  | { kind: "same" }
  | { kind: "onedrive"; dir: string }
  | { kind: "has-journal"; dir: string }
  | { kind: "empty"; dir: string }
  | { kind: "moving" }
  | { kind: "done"; message: string; oldDir: string }
  | { kind: "failed"; message: string };

const NUDGE_OPTIONS = [0, 2, 3, 4, 5, 6, 7, 8];

/** 분류 아이콘(18px 선 그림) */
const CAT_ICON: Record<SettingsCategory, string> = {
  screen: "M2.5 3.5h13v9h-13zM6.5 15.5h5M9 12.5v3",
  data: "M3.5 4.5c0-1.1 2.5-2 5.5-2s5.5.9 5.5 2v9c0 1.1-2.5 2-5.5 2s-5.5-.9-5.5-2zM3.5 4.5c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2M3.5 9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2",
  import: "M9 2.5v8.5M5.5 7.5 9 11l3.5-3.5M3 12.5v2.5h12v-2.5",
  work: "M3 4.5h12M3 9h12M3 13.5h7M12.5 13l1.5 1.5 2.5-2.5",
  update: "M14.5 9a5.5 5.5 0 1 1-1.6-3.9M14.5 2.8v3.2h-3.2",
};

/** 저장된 UTC 시각 → 이 PC 시각 `2026-10-25 14:03` */
function localWhen(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const isTextInput = (el: EventTarget | null): el is HTMLInputElement =>
  el instanceof HTMLInputElement && (el.type === "text" || el.type === "");

export function SettingsView() {
  const platform = useAppStore((s) => s.platform)!;
  const journal = useAppStore((s) => s.journal);
  const ready = journal.state === "ready" ? journal : null;
  const updateDot = useUpdate(hasUpdate);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [cat, setCat] = useState<SettingsCategory | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [last, setLast] = useState<BackupInfo | null>(null);
  const [imageUse, setImageUse] = useState<{ count: number; bytes: number } | null>(null);
  const [imports, setImports] = useState<ImportBatchInfo[]>([]);
  const [archived, setArchived] = useState<{ category: Category; endDate: string }[]>([]);
  const [rules, setRules] = useState<Recurrence[]>([]);
  const [cats, setCats] = useState<Map<string, Category>>(new Map());
  const [pending, setPending] = useState<Pending | null>(null);
  const [copyBackups, setCopyBackups] = useState(true);
  const tabRefs = useRef<Partial<Record<SettingsCategory, HTMLButtonElement | null>>>({});
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const refresh = useCallback(async () => {
    if (!ready) return;
    const s = await ready.repo.getSettings();
    setSettings(s);
    // 처음 열 때만: 마지막 본 분류, 새 판 점이 켜져 있으면 업데이트·정보(spec 1-2)
    setCat((c) => c ?? (hasUpdate(useUpdate.getState()) ? "update" : s.ui.settingsCategory));
    setSize((await platform.stat(journalPath(platform, ready.dataDir))).size);
    setLast(await lastBackupOf(platform, ready.dataDir));
    setImageUse(await ready.repo.noteAssetStats());
    setImports(await ready.repo.listImports());
    const { categories, periods } = await ready.repo.listCategories();
    setCats(new Map(categories.map((c) => [c.id, c])));
    setRules(await ready.repo.listRecurrences());
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

  // 처음 분류가 정해지면 그 탭에 포커스(spec 1-5)
  const focused = useRef(false);
  useEffect(() => {
    if (!cat || focused.current) return;
    focused.current = true;
    tabRefs.current[cat]?.focus();
  }, [cat]);

  // Esc(spec 1-5): 펼친 흐름 → 글 입력 되돌리기 → 보드로. 위에 다른 대화상자가 떠 있으면 그쪽 몫
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      if (isTextInput(e.target)) {
        e.target.value = e.target.defaultValue;
        e.target.blur();
        return;
      }
      if (pendingRef.current && pendingRef.current.kind !== "moving") return setPending(null);
      leaveSettings();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) return null;

  const choose = (c: SettingsCategory, focus = false) => {
    setCat(c);
    if (focus) tabRefs.current[c]?.focus();
    void ready.repo.updateSettings({ ui: { settingsCategory: c } }).catch(() => undefined);
  };

  const onTabKey = (e: ReactKeyboardEvent) => {
    const i = SETTINGS_CATEGORIES.indexOf(cat ?? "screen");
    const n = SETTINGS_CATEGORIES.length;
    const to =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? (i + 1) % n
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    choose(SETTINGS_CATEGORIES[to]!, true);
  };

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

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast(STR.toast.error(e instanceof Error ? e.message : String(e)));
    }
    await refresh();
  };

  const keep = settings ? settings.backup.dailyKeep + settings.backup.monthlyKeep : 0;
  const imageBytes = imageUse?.bytes ?? 0;
  const imageShare = size ? Math.min(100, Math.round((imageBytes / size) * 100)) : 0;

  const screen = <ThemeSettings />;

  const data = (
    <>
      <Card id="s-location" title={STR.settings.location} desc={STR.settings.locationDesc}>
        <Row
          label={STR.settings.folderLabel}
          desc={
            <code className={styles.path} data-testid="settings-data-dir">
              {ready.dataDir}
            </code>
          }
        >
          <button type="button" onClick={() => void platform.openFolder(ready.dataDir)}>
            {STR.settings.openFolder}
          </button>
          <button type="button" onClick={() => void pickLocation()} disabled={pending?.kind === "moving"}>
            {STR.settings.change}
          </button>
        </Row>
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
                  <button type="button" className={styles.primary} onClick={() => void doSwitch(pending.dir)}>
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
      </Card>

      <Card id="s-backup" title={STR.settings.backup} desc={STR.settings.backupDesc}>
        <Row
          label={STR.settings.lastBackupLabel}
          desc={last ? last.when : STR.settings.noBackup}
          descTestId="last-backup"
        >
          <button
            type="button"
            className={styles.primary}
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
        </Row>
        <Row
          label={STR.settings.policyLabel}
          desc={settings && STR.settings.backupPolicy(settings.backup.dailyKeep, settings.backup.monthlyKeep)}
        >
          <button
            type="button"
            onClick={() => void platform.openFolder(platform.join(ready.dataDir, BACKUP_DIR))}
          >
            {STR.settings.openBackups}
          </button>
        </Row>
      </Card>

      {/* 용량(weekly-note-spec 5-3): 메모 이미지는 일지 파일 안에 있어 백업 사본마다 함께 들어간다 */}
      <Card id="s-usage" title={STR.settings.usageTitle} desc={STR.settings.usageDesc}>
        {size !== null && imageUse && (
          <div className={styles.usage}>
            <div className={styles.usageHead}>
              <span data-testid="storage-usage">
                {STR.settings.usage(formatBytes(size), imageUse.count, formatBytes(imageUse.bytes))}
              </span>
              {settings && (
                <span className={styles.rowDesc}>
                  {STR.settings.usageBackups(keep, formatBytes(size * keep))}
                </span>
              )}
            </div>
            <div
              className={styles.usageBar}
              role="img"
              aria-label={STR.settings.usageBar(formatBytes(size), formatBytes(imageBytes))}
            >
              <span className={styles.usageText} style={{ width: `${100 - imageShare}%` }} />
              <span className={styles.usageImages} style={{ width: `${imageShare}%` }} />
            </div>
            <div className={styles.usageLegend}>
              <span>
                <i className={styles.usageText} />
                {STR.settings.usageText(formatBytes(Math.max(0, size - imageBytes)))}
              </span>
              <span>
                <i className={styles.usageImages} />
                {STR.settings.usageImages(formatBytes(imageBytes))}
              </span>
            </div>
          </div>
        )}
      </Card>
    </>
  );

  const importCat = (
    <>
      {/* 기존 일지 가져오기(i-m3-plan 3절) — 마법사는 설정을 닫고 연다 */}
      <Card id="s-import" title={STR.importer.title} desc={STR.settings.importCardDesc}>
        <Row label={STR.importer.title} desc={STR.importer.openHint}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              setSettingsOpen(false);
              openImport();
            }}
          >
            {STR.importer.open}
          </button>
        </Row>
      </Card>
      <Card id="s-import-history" title={STR.importer.history} desc={STR.settings.historyDesc}>
        {imports.length === 0 ? (
          <p className={styles.empty}>{STR.importer.historyEmpty}</p>
        ) : (
          <ul className={styles.list} data-testid="import-history">
            {imports.map((b) => (
              <li key={b.id}>
                <span className={`${styles.grow} ${b.undoneAt ? styles.muted : ""}`}>
                  {STR.importer.historyRow(localWhen(b.createdAt), b.fileName, b.weeks, b.items)}
                </span>
                {b.undoneAt ? (
                  <span className={styles.note}>{STR.importer.undone}</span>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      if (await undoImportBatch(b.id, b.items)) await refresh();
                    }}
                  >
                    {STR.importer.undo}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );

  const work = (
    <>
      <Card id="s-repeat" title={STR.settings.repeat} desc={STR.settings.repeatDesc}>
        {rules.length === 0 ? (
          <p className={styles.empty}>{STR.settings.noRepeat}</p>
        ) : (
          <ul className={styles.repeatList} data-testid="repeat-list">
            {rules.map((rule) => {
              const c = cats.get(rule.categoryId);
              const stopped = rule.endWeek !== null;
              return (
                <li key={rule.id} className={stopped ? styles.stopped : ""}>
                  <span className={styles.repeatDay}>{DAY_LABELS[rule.weekday - 1]}</span>
                  <span className={styles.repeatCat}>
                    <span className={styles.dot} style={{ background: `var(--cat-${c?.color ?? "c1"})` }} />
                    {c?.name}
                  </span>
                  <input
                    className={styles.repeatText}
                    defaultValue={rule.lines[0]?.text}
                    aria-label={STR.settings.repeatTextLabel}
                    maxLength={2000}
                    onBlur={(e) => {
                      const text = e.currentTarget.value;
                      if (text.trim() && text !== rule.lines[0]?.text)
                        void run(() => ready.repo.updateRecurrence(rule.id, { text }));
                    }}
                  />
                  <div className={styles.repeatMeta}>
                    <span className={styles.note}>
                      {rule.lines.length > 1 && `${STR.repeat.subCount(rule.lines.length - 1)} · `}
                      {stopped
                        ? STR.settings.repeatStopped(rule.endWeek!)
                        : STR.settings.repeatSince(rule.startWeek)}
                    </span>
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={rule.flagOnCreate}
                        onChange={(e) => {
                          const on = e.target.checked;
                          void run(() => ready.repo.updateRecurrence(rule.id, { flagOnCreate: on }));
                        }}
                      />
                      {STR.settings.repeatFlag}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        void run(() =>
                          ready.repo.updateRecurrence(rule.id, {
                            endWeek: stopped ? null : weekIdOf(ready.repo.today()),
                          }),
                        )
                      }
                    >
                      {stopped ? STR.settings.repeatResume : STR.settings.repeatStop}
                    </button>
                    <button
                      type="button"
                      className={styles.danger}
                      onClick={() => {
                        if (window.confirm(STR.settings.repeatDeleteConfirm(rule.lines[0]?.text ?? "")))
                          void run(() => ready.repo.deleteRecurrence(rule.id));
                      }}
                    >
                      {STR.settings.repeatDelete}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <TagSettings />

      <div className={styles.pair}>
        <Card id="s-cats" title={STR.settings.categories}>
          {archived.length === 0 ? (
            <p className={styles.empty}>{STR.settings.noArchived}</p>
          ) : (
            <ul className={styles.list}>
              {archived.map(({ category, endDate }) => (
                <li key={category.id}>
                  <span className={styles.dot} style={{ background: `var(--cat-${category.color})` }} />
                  <span className={styles.grow}>
                    {category.name}
                    <span className={styles.rowDesc}>{STR.settings.endedOn(endDate)}</span>
                  </span>
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
        </Card>

        <Card id="s-nudge" title={STR.settings.nudge}>
          <label className={styles.setRow}>
            <span className={styles.rowText}>
              <span className={styles.rowDesc}>{STR.settings.nudgeLabel}</span>
            </span>
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
        </Card>
      </div>
    </>
  );

  const update = (
    <>
      <UpdateSettings />
      <Card id="s-about" title={STR.settings.about}>
        <Row label={STR.appName} desc={STR.settings.version(__APP_VERSION__)} />
        <Row label={STR.settings.fontLabel} desc={STR.settings.fontCredit} />
      </Card>
    </>
  );

  const content: Record<SettingsCategory, ReactNode> = { screen, data, import: importCat, work, update };

  return (
    <section className={styles.view} aria-label={STR.settings.title} data-testid="settings-view">
      <nav className={styles.cats} aria-label={STR.settings.catsLabel}>
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label={STR.settings.catsLabel}
          onKeyDown={onTabKey}
        >
          {SETTINGS_CATEGORIES.map((c) => {
            const on = c === cat;
            return (
              <button
                key={c}
                ref={(el) => {
                  tabRefs.current[c] = el;
                }}
                type="button"
                role="tab"
                id={`settings-tab-${c}`}
                aria-selected={on}
                aria-controls="settings-panel"
                tabIndex={on || (cat === null && c === "screen") ? 0 : -1}
                className={`${styles.cat} ${on ? styles.catOn : ""}`}
                onClick={() => choose(c)}
              >
                <svg
                  className={styles.catIcon}
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={CAT_ICON[c]} />
                </svg>
                <span className={styles.catText}>
                  <span className={styles.catName}>{STR.settings.cats[c].name}</span>
                  <span className={styles.catDesc}>{STR.settings.cats[c].desc}</span>
                </span>
                {c === "update" && updateDot && (
                  <span className={styles.catDot} data-testid="settings-update-dot" />
                )}
              </button>
            );
          })}
        </div>
        <p className={styles.keys}>{STR.settings.keysHint}</p>
      </nav>
      <div
        className={styles.content}
        role="tabpanel"
        id="settings-panel"
        aria-labelledby={cat ? `settings-tab-${cat}` : undefined}
      >
        {cat && (
          <div className={styles.inner} data-testid={`settings-cat-${cat}`}>
            <div className={styles.catHead}>
              <h2>{STR.settings.cats[cat].name}</h2>
              <p>{STR.settings.cats[cat].intro}</p>
            </div>
            {content[cat]}
          </div>
        )}
      </div>
    </section>
  );
}
