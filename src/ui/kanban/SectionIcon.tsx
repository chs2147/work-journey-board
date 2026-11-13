// 칸반 섹션 아이콘(improve-v23-spec 8절) — Fluent Emoji Flat 36종(번들 SVG, 외부 통신 없음)과 고르기 판.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { SECTION_ICONS } from "../../shared/sectionIcons";
import { STR } from "../../shared/strings";
import styles from "./Kanban.module.css";

const BY_ID = new Map(SECTION_ICONS.map((i) => [i.id, i]));
const COLS = 9;

/** 아이콘 하나(모르는 id는 📌) */
export function SectionIconImg({ id, size = 18 }: { id: string; size?: number }) {
  const ic = BY_ID.get(id) ?? BY_ID.get("pushpin")!;
  return (
    <svg
      className={styles.secIcon}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      data-icon={ic.id}
      dangerouslySetInnerHTML={{ __html: ic.body }}
    />
  );
}

/** 고르기 판 — ←↑→↓ 고르기, Enter 정하기, Esc 닫기 */
export function IconPicker({
  at,
  value,
  title,
  onPick,
  onReset,
  onClose,
}: {
  at: { x: number; y: number };
  value: string;
  title: string;
  onPick(id: string): void;
  onReset?(): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const [cur, setCur] = useState(() =>
    Math.max(
      0,
      SECTION_ICONS.findIndex((i) => i.id === value),
    ),
  );
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)),
    });
  }, [at]);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>(`[data-i="${cur}"]`)?.focus();
  }, [cur]);
  useEffect(() => {
    const out = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, [onClose]);
  const onKey = (e: KeyboardEvent) => {
    const n = SECTION_ICONS.length;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      setCur((c) => Math.max(0, Math.min(n - 1, c + step)));
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  return (
    <div
      ref={ref}
      className={styles.picker}
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label={title}
      data-testid="kanban-icon-picker"
      onKeyDown={onKey}
    >
      <div className={styles.pickerHead}>{title}</div>
      <div className={styles.pickerGrid} role="listbox">
        {SECTION_ICONS.map((ic, i) => (
          <button
            key={ic.id}
            type="button"
            role="option"
            aria-selected={ic.id === value}
            aria-label={ic.label}
            title={ic.label}
            data-i={i}
            data-testid="kanban-icon-option"
            data-icon={ic.id}
            tabIndex={i === cur ? 0 : -1}
            className={ic.id === value ? styles.pickerOn : ""}
            onClick={() => onPick(ic.id)}
          >
            <SectionIconImg id={ic.id} size={22} />
          </button>
        ))}
      </div>
      {onReset && (
        <div className={styles.pickerFoot}>
          <button type="button" className={styles.btn} data-testid="kanban-icon-reset" onClick={onReset}>
            {STR.kanban.iconReset}
          </button>
        </div>
      )}
    </div>
  );
}
