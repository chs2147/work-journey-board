// 메모 보드 마크다운 내보내기 창(features-1102-spec F4): 범위·포함·이미지 고르기 + 미리보기 + [클립보드로 복사] [저장…].
import { useEffect, useState } from "react";
import { MD_IMAGE_DIR_SUFFIX } from "../../platform";
import { STR } from "../../shared/strings";
import { useBoard } from "../board/boardStore";
import { useAppStore } from "../common/appStore";
import styles from "./MarkdownExport.module.css";
import {
  buildMarkdown,
  closeMdExport,
  copyMarkdown,
  fileLabel,
  rangeWeeks,
  saveMarkdown,
  useMdExport,
  type MdRange,
} from "./markdownExport";

const T = STR.mdExport;

export function MarkdownExportDialog() {
  const s = useMdExport();
  const weekId = useBoard((st) => st.weekId);
  const journal = useAppStore((st) => st.journal);
  const [preview, setPreview] = useState<{ md: string; images: number } | null>(null);
  const weeks = rangeWeeks(s, weekId);
  const label = weeks ? fileLabel(weeks) : "";
  const imageDir = `메모보드_${label}${MD_IMAGE_DIR_SUFFIX}`;

  useEffect(() => {
    if (!s.open || journal.state !== "ready") return;
    let alive = true;
    void buildMarkdown(journal.repo, s, imageDir).then((r) => {
      if (alive) setPreview(r ? { md: r.markdown, images: r.images.length } : null);
    });
    return () => {
      alive = false;
    };
  }, [s, journal, imageDir]);
  if (!s.open) return null;
  const set = useMdExport.setState;

  return (
    <div className={styles.back} onMouseDown={(e) => e.target === e.currentTarget && closeMdExport()}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="md-export-title"
        data-testid="md-export"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closeMdExport();
          }
        }}
      >
        <header className={styles.head}>
          <h2 id="md-export-title">{T.title}</h2>
          <button type="button" className={styles.x} aria-label={T.close} onClick={closeMdExport}>
            ✕
          </button>
        </header>
        <div className={styles.body}>
          <div className={styles.side}>
            <fieldset>
              <legend>{T.range}</legend>
              <div className={styles.chips}>
                {(["week", "4w", "custom"] as MdRange[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    autoFocus={r === s.range}
                    aria-pressed={s.range === r}
                    className={`${styles.chip} ${s.range === r ? styles.chipOn : ""}`}
                    onClick={() => set({ range: r })}
                  >
                    {r === "week" ? T.ranges.week(weekId) : T.ranges[r]}
                  </button>
                ))}
              </div>
              {s.range === "custom" && (
                <div className={styles.dates}>
                  <input
                    type="date"
                    aria-label={T.from}
                    value={s.from}
                    onChange={(e) => set({ from: e.currentTarget.value })}
                  />
                  ~
                  <input
                    type="date"
                    aria-label={T.to}
                    value={s.to}
                    onChange={(e) => set({ to: e.currentTarget.value })}
                  />
                </div>
              )}
              {!weeks && <p className={styles.bad}>{T.badRange}</p>}
            </fieldset>
            <fieldset>
              <legend>{T.include}</legend>
              <label>
                <input
                  type="checkbox"
                  checked={s.links}
                  onChange={(e) => set({ links: e.currentTarget.checked })}
                />{" "}
                {T.links}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={s.edges}
                  onChange={(e) => set({ edges: e.currentTarget.checked })}
                />{" "}
                {T.edges}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={s.emptyWeeks}
                  onChange={(e) => set({ emptyWeeks: e.currentTarget.checked })}
                />{" "}
                {T.emptyWeeks}
              </label>
            </fieldset>
            <fieldset>
              <legend>{T.images}</legend>
              <label>
                <input
                  type="radio"
                  name="md-img"
                  checked={s.images === "files"}
                  onChange={() => set({ images: "files" })}
                />{" "}
                {T.imageFiles}
              </label>
              <label>
                <input
                  type="radio"
                  name="md-img"
                  checked={s.images === "none"}
                  onChange={() => set({ images: "none" })}
                />{" "}
                {T.imageNone}
              </label>
            </fieldset>
            <fieldset>
              <legend>{T.file}</legend>
              <div className={styles.file}>{T.fileName(label)}</div>
              <p className={styles.note}>
                {s.images === "files" && preview?.images
                  ? T.folderNote(imageDir, preview.images)
                  : T.noImages}
              </p>
            </fieldset>
            <span className={styles.grow} />
            <div className={styles.actions}>
              <button type="button" disabled={!preview?.md} onClick={() => void copyMarkdown()}>
                {T.copy}
              </button>
              <span className={styles.grow} />
              <button type="button" onClick={closeMdExport}>
                {T.cancel}
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={!preview?.md}
                data-testid="md-export-save"
                onClick={() => void saveMarkdown()}
              >
                {T.save}
              </button>
            </div>
          </div>
          <div className={styles.previewWrap}>
            <div className={styles.legend}>{T.preview}</div>
            <pre className={styles.preview} data-testid="md-preview">
              {preview === null ? "" : preview.md || T.emptyPreview}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
