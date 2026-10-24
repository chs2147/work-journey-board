// 주간 요약 패널(overview 10-7): 보드 오른쪽 360px, 보고 있는 주를 따라간다. 탭 = 자동 집계 | 수정본(AI본은 I-M4).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { basisText, finalVersion } from "../../domain/aggregate";
import { sha256Hex } from "../../shared/hash";
import { STR } from "../../shared/strings";
import { focusStartCell, useBoard } from "../board/boardStore";
import {
  acknowledgeChange,
  autoText,
  boardSummaryInput,
  copyFinal,
  deleteEdited,
  editDraft,
  flushDraft,
  makeEdited,
  setCompareOpen,
  setIncludeMemo,
  setSummaryOpen,
  setTab,
  useSummary,
  type SummaryTab,
} from "./summaryStore";
import styles from "./SummaryPanel.module.css";

const TABS: SummaryTab[] = ["auto", "edited"];

export function SummaryPanel({ overlay }: { overlay: boolean }) {
  const { tab, includeMemo, saved, draft, compareOpen, focusRequest, weekId } = useSummary();
  // 보드 화면 상태가 바뀔 때마다 다시 계산(입력 중인 글도 반영)
  const view = useBoard((s) => s.view);
  const cells = useBoard((s) => s.cells);
  const memos = useBoard((s) => s.memos);
  const input = useMemo(() => boardSummaryInput(), [view, cells, memos]); // eslint-disable-line react-hooks/exhaustive-deps
  const auto = input ? autoText(input, includeMemo) : "";
  const changed = useBasisChanged(
    input ? basisText(input) : null,
    saved?.editedBasisHash ?? null,
    draft !== null,
  );
  const version = finalVersion({ editedText: draft, aiText: saved?.aiText });
  const panelRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  // Alt+S로 열면 지금 탭으로 포커스(닫거나 Esc면 원래 자리로)
  useEffect(() => {
    if (!focusRequest) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && !panelRef.current?.contains(active)) returnTo.current = active;
    panelRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [focusRequest]);

  const backToBoard = () => {
    void flushDraft();
    const el = returnTo.current;
    returnTo.current = null;
    if (el?.isConnected) el.focus();
    else focusStartCell();
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
    setTab(next);
    panelRef.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };

  const make = async () => {
    await makeEdited();
    editorRef.current?.focus();
  };

  return (
    <aside
      ref={panelRef}
      className={`${styles.panel} ${overlay ? styles.overlay : ""}`}
      aria-label={STR.summary.title}
      data-testid="summary-panel"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          backToBoard();
        }
      }}
    >
      <div className={styles.head}>
        <h2 className={styles.title}>
          {STR.summary.title} <span className={styles.week}>{weekId}</span>
        </h2>
        <button
          type="button"
          className={styles.close}
          aria-label={STR.summary.close}
          title={STR.summary.close}
          onClick={() => {
            setSummaryOpen(false);
            backToBoard();
          }}
        >
          ×
        </button>
      </div>

      <div className={styles.tabsRow}>
        <div role="tablist" className={styles.tabs} aria-label={STR.summary.title}>
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              data-tab={t}
              aria-selected={tab === t}
              tabIndex={tab === t ? 0 : -1}
              className={styles.tab}
              onClick={() => setTab(t)}
              onKeyDown={onTabKey}
            >
              {t === "auto" ? STR.summary.tabAuto : STR.summary.tabEdited}
              {t === "edited" && draft !== null && (
                <span className={styles.dot} aria-label={STR.summary.savedMark}>
                  ●
                </span>
              )}
            </button>
          ))}
        </div>
        <span className={styles.final} data-testid="summary-final">
          {STR.summary.final(STR.summary.versionName[version])}
        </span>
      </div>

      <div className={styles.body} role="tabpanel">
        {tab === "auto" ? (
          <>
            <pre className={styles.text} data-testid="summary-auto" tabIndex={0}>
              {auto}
            </pre>
            <div className={styles.actions}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={includeMemo}
                  onChange={(e) => setIncludeMemo(e.target.checked)}
                />
                {STR.summary.includeMemo}
              </label>
              {draft === null && (
                <button type="button" className={styles.button} onClick={() => void make()}>
                  {STR.summary.make}
                </button>
              )}
            </div>
          </>
        ) : draft === null ? (
          <div className={styles.empty}>
            <p>{STR.summary.noEdited}</p>
            <p className={styles.hint}>{STR.summary.makeHint}</p>
            <button type="button" className={styles.button} onClick={() => void make()}>
              {STR.summary.make}
            </button>
          </div>
        ) : (
          <>
            {changed && (
              <div className={styles.changed} role="status" data-testid="summary-changed">
                <span>{STR.summary.changed}</span>
                <span className={styles.changedActions}>
                  <button type="button" onClick={() => setCompareOpen(!compareOpen)}>
                    {compareOpen ? STR.summary.compareHide : STR.summary.compare}
                  </button>
                  <button type="button" onClick={() => void acknowledgeChange()}>
                    {STR.summary.acknowledge}
                  </button>
                </span>
              </div>
            )}
            <textarea
              ref={editorRef}
              className={styles.editor}
              value={draft}
              aria-label={STR.summary.editedLabel}
              data-testid="summary-edited"
              spellCheck={false}
              onChange={(e) => editDraft(e.target.value)}
              onBlur={() => void flushDraft()}
            />
            {changed && compareOpen && (
              <div className={styles.compare}>
                <div className={styles.compareTitle}>{STR.summary.compareTitle}</div>
                <pre className={styles.text} data-testid="summary-compare">
                  {auto}
                </pre>
              </div>
            )}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.button}
                onClick={() => {
                  if (window.confirm(STR.summary.regenerateConfirm)) void make();
                }}
              >
                {STR.summary.regenerate}
              </button>
              <button type="button" className={styles.button} onClick={() => void deleteEdited()}>
                {STR.summary.delete}
              </button>
            </div>
          </>
        )}
      </div>

      <div className={styles.foot}>
        <button type="button" className={styles.primary} onClick={() => void copyFinal()}>
          {STR.summary.copy}
        </button>
      </div>
    </aside>
  );
}

/** 저장된 근거 해시와 지금 기록의 해시가 다른가(output-spec 2-3). 해시는 비동기라 한 박자 늦게 맞춰진다 */
function useBasisChanged(basis: string | null, savedHash: string | null, hasEdited: boolean): boolean {
  const [current, setCurrent] = useState<{ text: string; hash: string } | null>(null);
  useEffect(() => {
    if (basis === null || !hasEdited) return;
    let alive = true;
    void sha256Hex(basis).then((hash) => alive && setCurrent({ text: basis, hash }));
    return () => {
      alive = false;
    };
  }, [basis, hasEdited]);
  if (!hasEdited || savedHash === null || current === null || current.text !== basis) return false;
  return current.hash !== savedHash;
}
