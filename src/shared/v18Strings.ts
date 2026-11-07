import { localizeTree } from "./platformText";
export const V18 = localizeTree({
  image: "이미지",
  importHint: "Markdown 문서 가져오기",
  create: "만들기",
  clipboard: "클립보드",
  view: "보기",
  openPalette: "도구 팔레트 펼치기",
  closePalette: "도구 팔레트 접기",
  rowMenu: "표 행 메뉴",
  columnMenu: "표 열 메뉴",
  tableMenu: "표 편집",
  tableDelete: "표 전체가 삭제됩니다. 삭제할까요?",
  close: "닫기",
  frameHint: "가로·세로 크기 조절 · Shift 비율 유지 · Esc 취소",
  frame: (side: string) => "객체 크기 조절 " + side,
  widgetHints: {
    elapsed: "시작일 또는 마지막 기록일 기준 경과일",
    timeline: "기록 목록·가로 마일스톤·주차 요약",
    important: "미완료 중요 업무 · 원본과 완료 상태 연동",
  },
});
export const TABLE_ACTIONS = {
  row: [
    ["addRowBefore", "행 위에 추가"],
    ["addRowAfter", "행 아래에 추가"],
    ["deleteRow", "행 삭제"],
  ],
  column: [
    ["addColumnBefore", "열 왼쪽에 추가"],
    ["addColumnAfter", "열 오른쪽에 추가"],
    ["deleteColumn", "열 삭제"],
  ],
  table: [
    ["toggleHeaderRow", "머리글 행 전환"],
    ["deleteTable", "표 삭제"],
  ],
} as const;
