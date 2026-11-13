// 완료 축하 모션(docs/improve-v22-spec.md 7절): 카드 자리에 초록 체크(0.25s) + 색종이 14개(0.9s). CSS만 — 외부 라이브러리 없음.
// OS "동작 줄이기"면 체크만 잠깐. 설정 › 화면 [완료 축하 모션]으로 끈다(이 PC 설정).
import { createPortal } from "react-dom";
import { useKanban } from "./kanbanStore";
import styles from "./Celebration.module.css";

const PIECES = 14;
const COLORS = ["var(--accent)", "#2f9e5b", "#e8b628", "var(--accent)", "#2f9e5b", "#e8b628", "#d96c4a"];

export function Celebration() {
  const c = useKanban((k) => k.celebrating);
  if (!c) return null;
  // 문서 맨 위 레이어(document.body)에 — 보드 화면의 쌓임·잘림과 무관하게(improve-v23-spec 6절)
  return createPortal(
    <div
      key={c.key}
      className={styles.layer}
      style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
      aria-hidden="true"
      data-testid="kanban-celebrate"
    >
      <span className={styles.check}>✓</span>
      {Array.from({ length: PIECES }, (_, i) => {
        // 위쪽 반원으로 고르게 튀었다가 아래로 떨어짐
        const a = Math.PI * (1.05 + (0.9 * i) / (PIECES - 1));
        const dist = 46 + ((i * 37) % 28);
        return (
          <span
            key={i}
            className={styles.piece}
            style={
              {
                background: COLORS[i % COLORS.length],
                "--dx": `${Math.cos(a) * dist * 1.6}px`,
                "--dy": `${Math.sin(a) * dist}px`,
                "--rot": `${(i * 53) % 360}deg`,
                animationDelay: `${(i % 4) * 18}ms`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>,
    document.body,
  );
}
