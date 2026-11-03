// 워크스페이스 모노그램 아이콘(multi-board-spec, 2026-11-03 사용자 지시): 아이폰 이모지의 생산성 도구(사물·사무용품)를
// 한 색 선 그림으로 다시 그린 것. 글자(첫 글자·알파벳)는 쓰지 않는다. 색 사각형 위에 흰 선으로 그린다(WorkspaceMark).
// 24×24 격자, 선 1.8, 끝 둥글게 — 외부 글꼴·이모지 글꼴에 기대지 않는다(외부 통신 0, 윈도우·맥 같은 모양).
import type { ReactNode } from "react";
import type { WorkspaceIcon } from "../../domain/workspace";
import type { CategoryColorKey } from "../../shared/palette";
import styles from "./WorkspaceMark.module.css";

/** 💼 📁 📅 📋 📝 ✏️ 📓 📚 💡 📈 📊 📌 📎 💻 ✉️ 📦 🏷 🔒 🔑 🔧 🔍 ⏰ ⌛ 🗂 ✂️ 📐 💰 💳 */
const PATHS: Record<WorkspaceIcon, ReactNode> = {
  briefcase: (
    <>
      <rect x="3" y="7.5" width="18" height="12" rx="2.2" />
      <path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5M3 12.5h18M10.5 12.5v1.8h3v-1.8" />
    </>
  ),
  folder: (
    <path d="M3 7.2A2.2 2.2 0 0 1 5.2 5h4l2 2.3h7.6A2.2 2.2 0 0 1 21 9.5v8.3a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 17.8z" />
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
      <path d="M3.5 9.8h17M8 3v4M16 3v4" />
      <path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <rect x="9" y="3" width="6" height="3.2" rx="1" />
      <path d="M8.5 11h7M8.5 14.5h7M8.5 18h4" />
    </>
  ),
  memo: (
    <>
      <path d="M13.5 20.5H6.2A2.2 2.2 0 0 1 4 18.3V5.7a2.2 2.2 0 0 1 2.2-2.2h9.6A2.2 2.2 0 0 1 18 5.7v3.8" />
      <path d="M7.5 8h7M7.5 11.5h5M7.5 15h3" />
      <path d="M20.6 12.4a1.5 1.5 0 0 0-2.1 0l-5 5-.6 2.7 2.7-.6 5-5a1.5 1.5 0 0 0 0-2.1z" />
    </>
  ),
  pencil: (
    <>
      <path d="M15.5 4.5a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3L9 19l-4.5 1 1-4.5z" />
      <path d="M13.5 6.5l4 4M5.5 15.5l3 3" />
    </>
  ),
  notebook: (
    <>
      <rect x="5" y="3" width="14.5" height="18" rx="2" />
      <path d="M9 3v18M3.5 7h3M3.5 11h3M3.5 15h3M12 8h4.5M12 11.5h4.5" />
    </>
  ),
  books: (
    <>
      <rect x="3.5" y="4" width="4.5" height="16.5" rx="1" />
      <rect x="8" y="6.5" width="4.5" height="14" rx="1" />
      <path d="M13.6 7.6l4.2-1.4 3.7 12.6-4.2 1.4z" />
      <path d="M3.5 8h4.5M8 10h4.5M3.5 16.5h4.5M8 17h4.5" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 17.5v-1.7a6.5 6.5 0 1 1 6 0v1.7z" />
      <path d="M9.5 20.5h5M12 13v4.5M10.2 11.6L12 13l1.8-1.4" />
    </>
  ),
  chartUp: (
    <>
      <rect x="3" y="3.5" width="18" height="17" rx="2" />
      <path d="M6.5 16.5l4-4.5 3 2.5 4.5-6" />
      <path d="M15 8.5h3v3" />
    </>
  ),
  chartBar: (
    <>
      <rect x="3" y="3.5" width="18" height="17" rx="2" />
      <path d="M7.5 17v-4M11 17V8.5M14.5 17v-6M18 17v-8" />
    </>
  ),
  pin: (
    <>
      <path d="M9 3.5h6l-1 5.5 3.5 3.2v1.3h-11v-1.3L10 9z" />
      <path d="M12 13.5v7" />
    </>
  ),
  paperclip: (
    <path d="M16.5 7.5l-7 7a2 2 0 0 0 2.8 2.8l7.4-7.4a3.8 3.8 0 0 0-5.4-5.4L6.6 12a5.6 5.6 0 0 0 7.9 7.9l5-5" />
  ),
  laptop: (
    <>
      <rect x="5" y="5" width="14" height="10" rx="1.6" />
      <path d="M2.5 18.5h19l-1.3-3.5H3.8z" />
    </>
  ),
  envelope: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3.5 7l8.5 6.2L20.5 7" />
    </>
  ),
  package: (
    <>
      <path d="M12 3l8.5 4.5v9L12 21l-8.5-4.5v-9z" />
      <path d="M3.5 7.5L12 12l8.5-4.5M12 12v9M7.8 5.2l8.5 4.6" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 4.8v6a2 2 0 0 0 .6 1.4l7.8 7.8a2 2 0 0 0 2.8 0l5.4-5.4a2 2 0 0 0 0-2.8L12.3 4a2 2 0 0 0-1.4-.6H5a1.5 1.5 0 0 0-1.5 1.4z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15.5" r="4.5" />
      <path d="M11.3 12.3L20 3.5M16.5 7l2.5 2.5M14 9.5l2 2" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.4-3.4a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z" />
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.3 15.3l5.2 5.2" />
    </>
  ),
  alarm: (
    <>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 9v4.3l2.8 1.7M4 5.5L6.5 3M20 5.5L17.5 3M6.5 19.5L5 21M17.5 19.5L19 21" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6 3h12M6 21h12" />
      <path d="M7.5 3v2.5a4.5 4.5 0 0 0 2 3.7L12 11l2.5-1.8a4.5 4.5 0 0 0 2-3.7V3M7.5 21v-2.5a4.5 4.5 0 0 1 2-3.7L12 13l2.5 1.8a4.5 4.5 0 0 1 2 3.7V21" />
    </>
  ),
  cardIndex: (
    <>
      <rect x="3" y="9" width="18" height="11.5" rx="2" />
      <path d="M5.5 9V6.5h13V9M7.5 6.5V4h9v2.5M9.5 13.5h5" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6.5" cy="6.5" r="2.8" />
      <circle cx="6.5" cy="17.5" r="2.8" />
      <path d="M8.6 8.4L20 18.5M8.6 15.6L20 5.5M13.5 12h.01" />
    </>
  ),
  ruler: (
    <>
      <path d="M4 20V4l16 16z" />
      <path d="M8.5 15.5V12l3.5 3.5zM4 8h2M4 12h2.5M4 16h2" />
    </>
  ),
  moneyBag: (
    <>
      <path d="M9 7.5h6l-1.4-3.8a.8.8 0 0 0-.8-.6h-1.6a.8.8 0 0 0-.8.6zM9.2 7.5C5.5 10 4 13.3 4 16.2 4 19 6 21 9 21h6c3 0 5-2 5-4.8 0-2.9-1.5-6.2-5.2-8.7" />
      <path d="M13.8 12.3c-.4-.7-1.1-1-1.8-1-1 0-1.8.6-1.8 1.4 0 1.9 3.6 1 3.6 2.9 0 .8-.8 1.4-1.8 1.4-.8 0-1.5-.4-1.9-1M12 10v1.3M12 16.9v1.3" />
    </>
  ),
  creditCard: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M2.5 9.5h19M6 15h4M14 15h3" />
    </>
  ),
};

/** 아이콘만(선 그림) — 고르기 칸·목록에서 */
export function WorkspaceGlyph({ icon, size = 18 }: { icon: WorkspaceIcon; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[icon]}
    </svg>
  );
}

/** 공간 표시: 공간 색 둥근 사각형 + 흰 모노그램(레일 단추·목록·알림) */
export function WorkspaceMark({
  icon,
  color,
  size = 28,
  title,
}: {
  icon: WorkspaceIcon;
  color: CategoryColorKey;
  size?: number;
  title?: string;
}) {
  return (
    <span
      className={styles.mark}
      style={{ width: size, height: size, background: `var(--cat-${color})` }}
      title={title}
      aria-label={title}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      data-icon={icon}
    >
      <WorkspaceGlyph icon={icon} size={Math.round(size * 0.62)} />
    </span>
  );
}
