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
