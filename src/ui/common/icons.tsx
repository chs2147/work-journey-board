// 단추 아이콘(improve-1026-spec 11-3): 외부 아이콘 글꼴·CDN 없이 인라인 SVG — 16px, currentColor, 선 1.5px.
// 이름·단축키는 아이콘을 쓰는 단추의 aria-label·title이 맡는다(아이콘 자체는 aria-hidden).
import type { ReactNode } from "react";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconMinus = () => (
  <Svg>
    <path d="M3.5 8h9" />
  </Svg>
);

export const IconPlus = () => (
  <Svg>
    <path d="M8 3.5v9M3.5 8h9" />
  </Svg>
);

/** 화면에 맞춤: 네 모서리 */
export const IconFit = () => (
  <Svg>
    <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" />
  </Svg>
);

/** 텍스트 상자 추가: 상자 + T */
export const IconTextBox = () => (
  <Svg>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M5.5 5.5h5M8 5.5v5" />
  </Svg>
);

/** 이미지 넣기: 액자 + 산 */
export const IconImage = () => (
  <Svg>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <circle cx="5.75" cy="6.25" r="1" />
    <path d="M2.5 11.5l3.5-3.5 2.5 2.5 2-2 3 3" />
  </Svg>
);

/** 크게 보기: 바깥으로 */
export const IconExpand = () => (
  <Svg>
    <path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9" />
  </Svg>
);

/** 보드와 함께 보기: 안으로 */
export const IconShrink = () => (
  <Svg>
    <path d="M13.5 6.5h-4v-4M9.5 6.5L14 2M2.5 9.5h4v4M6.5 9.5L2 14" />
  </Svg>
);

export const IconChevronDown = () => (
  <Svg>
    <path d="M4 6l4 4 4-4" />
  </Svg>
);

export const IconChevronUp = () => (
  <Svg>
    <path d="M4 10l4-4 4 4" />
  </Svg>
);

/** 미니맵: 접힌 지도 */
export const IconMap = () => (
  <Svg>
    <path d="M2 4l4-1.5 4 1.5 4-1.5v9.5l-4 1.5-4-1.5-4 1.5z M6 2.5v9.5M10 4v9.5" />
  </Svg>
);

/** 링크 넣기: 사슬 */
/**
 * 중요 업무 처리 완료 뱃지(improve-1027v4-spec 2절): 초록 원 + 체크. 색은 --done/--on-done(라이트·다크),
 * 색만이 아니라 체크 모양으로 구분. 이름은 쓰는 쪽이 aria-label로 단다.
 */
export const IconDone = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    <circle cx="9" cy="9" r="8" fill="var(--done)" />
    <path
      d="M5.2 9.3 7.8 11.8 12.8 6.6"
      fill="none"
      stroke="var(--on-done)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** 메모 보드 스냅샷(improve-1027v3-spec 1-2): 카메라 */
export const IconCamera = () => (
  <Svg>
    <path d="M2 5.25h2.5l1.2-2h4.6l1.2 2H14v7.5H2z" />
    <circle cx="8" cy="9" r="2.25" />
  </Svg>
);

/** 관계선 보기(note-relation-spec 1-2): 두 상자를 잇는 꺾은선 */
export const IconRelation = () => (
  <Svg>
    <rect x="1.75" y="2.25" width="5" height="4" rx="1" />
    <rect x="9.25" y="9.75" width="5" height="4" rx="1" />
    <path d="M6.75 4.25h2a2 2 0 0 1 2 2v3.5" />
  </Svg>
);

export const IconLink = () => (
  <Svg>
    <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.12-2.12a2.5 2.5 0 0 0-3.54-3.54l-.7.7" />
    <path d="M9.25 6.75a2.5 2.5 0 0 0-3.54 0L3.6 8.87a2.5 2.5 0 0 0 3.54 3.54l.7-.7" />
  </Svg>
);

/** 행 삭제: 휴지통(improve-1026v2-spec 1-1) */
export const IconTrash = () => (
  <Svg>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Svg>
);

/** 주간 뷰: 달력 + 요일 칸(improve-1026v2-spec 9절) */
export const IconWeekView = () => (
  <Svg>
    <rect x="1.75" y="2.75" width="12.5" height="11.5" rx="1.75" />
    <path d="M1.75 6.25h12.5M4.75 8.5v3.5M7 8.5v3.5M9.25 8.5v3.5M11.5 8.5v3.5" />
  </Svg>
);

/** 오늘 뷰: 한 장짜리 일력 + 그 날 날짜 숫자(10절) — 숫자는 본문 글꼴 */
export const IconDayView = ({ day }: { day: number }) => (
  <Svg>
    <rect x="2.75" y="2.75" width="10.5" height="11.5" rx="1.75" />
    <path d="M2.75 6.25h10.5M5.75 1.5v2.5M10.25 1.5v2.5" />
    <text
      x="8"
      y="12.9"
      textAnchor="middle"
      fontSize={day >= 10 ? 6.4 : 7}
      fontWeight="700"
      fill="currentColor"
      stroke="none"
      fontFamily="inherit"
    >
      {day}
    </text>
  </Svg>
);

/** 업무연계 메모 만들기·배지: 메모 종이(improve-1026v2-spec 4·6-2절) */
export const IconNote = () => (
  <Svg>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <path d="M5 6h6M5 8.5h4" />
  </Svg>
);

/** 연결 해제: 끊긴 사슬(7절) */
export const IconUnlink = () => (
  <Svg>
    <path d="M6.5 9.5l3-3M4.6 8.4l-1 1a2.5 2.5 0 0 0 3.5 3.5l1-1M11.4 7.6l1-1a2.5 2.5 0 0 0-3.5-3.5l-1 1M2.5 2.5l11 11" />
  </Svg>
);
