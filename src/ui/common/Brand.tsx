// 앱 아이콘·워드마크(docs/brand-spec.md). 그림은 src/shared/brand/*.svg 한 곳 — 스플래시 창(splash.html)도 같은 SVG를 쓴다.
import iconSvg from "../../shared/brand/icon.svg?raw";
import wordmarkSvg from "../../shared/brand/wordmark.svg?raw";
import styles from "./Brand.module.css";

/** 아이콘 + 워드마크 한 묶음. 읽히는 이름은 워드마크의 aria-label("Work Journey Board") 하나. */
export function BrandLockup({ size }: { size: "bar" | "hero" }) {
  return (
    <span className={`${styles.lockup} ${styles[size]}`}>
      {/* 저장소에 들어 있는 고정 그림(사용자 입력 아님) */}
      <span className={styles.icon} aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg }} />
      <span className={styles.wordmark} dangerouslySetInnerHTML={{ __html: wordmarkSvg }} />
    </span>
  );
}
