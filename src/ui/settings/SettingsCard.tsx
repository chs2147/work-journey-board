// 설정 화면의 카드·설정 행(improve-1027v5-spec 1-3): 카드 = 제목 + 한 줄 설명 + 행들, 행 = 왼쪽 이름·설명 / 오른쪽 조작.
import type { ReactNode } from "react";
import styles from "./Settings.module.css";

export function Card({
  id,
  title,
  desc,
  testId,
  children,
}: {
  id: string;
  title: string;
  desc?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.card} aria-labelledby={id} data-testid={testId}>
      <header className={styles.cardHead}>
        <h3 id={id}>{title}</h3>
        {desc && <p className={styles.cardDesc}>{desc}</p>}
      </header>
      {children}
    </section>
  );
}

export function Row({
  label,
  desc,
  descTestId,
  children,
}: {
  label: ReactNode;
  desc?: ReactNode;
  descTestId?: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.setRow}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {desc && (
          <span className={styles.rowDesc} data-testid={descTestId}>
            {desc}
          </span>
        )}
      </div>
      {children && <div className={styles.rowCtl}>{children}</div>}
    </div>
  );
}
