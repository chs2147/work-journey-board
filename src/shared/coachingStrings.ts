// 앱 안 코칭(기능 둘러보기) 문구 한 곳(coaching-spec 6절) — 윈도우 표기로 쓰고 맥은 osText가 ⌘·⌥·Finder로 바꾼다.
// 투어 단계 대상·동작은 src/ui/coaching/tours.ts, 여기는 글만.

export type TourId = "T0" | "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "T8" | "T9" | "T10";

/** 단계 글: 제목·설명·단축키 칩(없으면 생략) */
export interface StepText {
  title: string;
  body: string;
  keys?: string;
}

export const COACH = {
  rail: "기능 둘러보기 (F1)",
  railNew: "기능 둘러보기 (F1) — 아직 보지 않은 둘러보기가 있어요",
  ribbon: "예시 화면 — 내 기록은 그대로",
  preparing: "예시 화면을 준비하는 중…",
  returning: "내 일지로 돌아가는 중…",
  skip: "건너뛰기",
  prev: "이전",
  next: "다음",
  finish: "마치기",
  tapHint: "밝은 곳을 눌러 보세요",
  count: (i: number, n: number) => `${i} / ${n}`,
  blocked: "기능 둘러보기 중에는 공간을 바꿀 수 없습니다",
  failed: (m: string) => `예시 화면을 열지 못했습니다 — ${m}`,
  skippedHint: "왼쪽 아래 ? 단추(F1)에서 언제든 다시 볼 수 있어요",
  dialog: "기능 둘러보기",
  /** 업무노트·업무 메모보드 투어는 그 별도 창 안에서 — 메인 창은 기다린다(coaching-spec 13절) */
  away: {
    note: "예시 업무노트 창에서 둘러보는 중…",
    board: "예시 업무 메모보드 창에서 둘러보는 중…",
    stop: "그만 보기",
  },

  menu: {
    title: "기능 둘러보기",
    close: "닫기 (Esc)",
    here: "이 화면",
    groups: {
      start: "시작",
      board: "주간 보드",
      views: "칸반·인사이트·Universe",
      side: "중요 업무·Cabi.NET",
    },
    done: "✓ 완료",
    progress: (i: number, n: number) => `${i} / ${n}`,
    newSteps: (n: number) => `새 단계 ${n}`,
    restart: "처음부터",
    suggest: "화면별 둘러보기 제안",
    reset: "진행 기록 지우기",
    resetDone: "진행 기록을 지웠습니다 — 다음에 앱을 켜면 처음 안내가 다시 나옵니다",
    guide: "이용 가이드 열기 ↗",
    sample: "예시 화면으로 바꿔 보여 드리고, 끝나면 지금 화면으로 돌아옵니다",
  },

  settings: {
    title: "기능 둘러보기",
    open: "기능 둘러보기 열기 (F1)",
    openBtn: "열기",
    replay: "처음 설치처럼 다시 보기",
    replayBtn: "다시 보기",
  },

  welcome: {
    badge: "NEW",
    title: "어디에 뭐가 있는지,\n콕콕 짚어 드릴게요",
    body: "예시 일지 화면 위에서 주요 기능을 1분 만에 익혀 보세요. 내 기록은 그대로예요.",
    start: "1분 둘러보기 시작 ▶",
    pick: "골라서 보기",
    later: "다음에",
    chips: ["주간 보드", "메모 보드", "칸반", "인사이트", "Universe", "중요 업무", "Cabi.NET"],
  },

  feature: {
    badge: "NEW",
    title: "짜잔, 새로 생긴 ? 단추예요",
    body: "여기서 기능 둘러보기를 언제든 열 수 있어요(F1). 예시 화면으로 1분만 둘러볼까요?",
    start: "1분 둘러보기 ▶",
    list: "목록 보기",
    later: "다음에",
  },

  afterStart: {
    title: "1분 둘러보기 끝!",
    body: "다음에 볼 만한 것",
    close: "닫기",
  },

  suggest: {
    label: (name: string) => `${name} 30초 둘러보기`,
    go: "▶ 보기",
    close: "닫기",
  },

  tours: {
    T0: {
      name: "시작하기 — 1분 둘러보기",
      time: "1분",
      steps: [
        {
          title: "반가워요!",
          body: "요일 칸에 업무를 적어 두면 주간 요약·경과·엑셀이 저절로 만들어집니다. 예시 일지로 1분만 둘러볼게요 — 끝나면 내 일지로 돌아옵니다.",
        },
        {
          title: "화면 이동",
          body: "주간 보드·칸반·인사이트·Universe, 중요 업무·Cabi.NET을 여기서 오갑니다.",
        },
        { title: "업무 = 한 줄", body: "업무마다 한 줄씩. ⋯ 에서 이름·색·시작일·종료를 바꿉니다." },
        {
          title: "오늘 칸에 적기",
          body: "칸을 누르고 쓰면 끝. Enter 새 항목, Tab 세부 항목. 자동 저장됩니다.",
          keys: "Enter · Tab",
        },
        { title: "업무 늘리기", body: "새 업무를 한 줄로 더합니다." },
        { title: "보기 바꾸기", body: "한 주 전체 또는 하루만 크게 봅니다.", keys: "Alt+V" },
        { title: "한 해 훑기", body: "기록이 있는 주를 달력으로 보고 바로 이동합니다.", keys: "Alt+Y" },
        {
          title: "보고서 초안",
          body: "이번 주 기록이 업무별로 정리됩니다. 고쳐 쓰거나 AI 지시문과 함께 복사하세요.",
          keys: "Alt+S",
        },
        { title: "엑셀로", body: "여러 주를 엑셀 파일로 저장합니다.", keys: "Alt+E" },
        {
          title: "언제든 다시",
          body: "칸반·인사이트·Universe 같은 다른 화면 둘러보기는 여기서 고릅니다.",
          keys: "F1",
        },
      ],
    },
    T1: {
      name: "화면 구성과 왼쪽 메뉴",
      time: "40초",
      steps: [
        {
          title: "공간",
          body: "회사·개인처럼 공간을 나눠 씁니다. 온라인 공간도 여기서.",
          keys: "Ctrl+Alt+1~9",
        },
        { title: "주간 보드", body: "매일 기록하는 기본 화면입니다.", keys: "Alt+1" },
        { title: "칸반", body: "적은 항목을 상태별 카드로 봅니다.", keys: "Alt+6" },
        { title: "인사이트", body: "업무가 어떻게 흘러왔는지 봅니다.", keys: "Alt+3" },
        { title: "Universe", body: "기록과 지식이 이어진 연결 지도입니다.", keys: "Alt+5" },
        {
          title: "중요 업무",
          body: "숫자 = 아직 끝나지 않은 중요 항목, 빨간 점 = 마감 지남.",
          keys: "Alt+2",
        },
        { title: "Cabi.NET", body: "업무별 자료·노트·메모보드를 모읍니다.", keys: "Alt+4" },
        { title: "설정", body: "테마·백업·워크스페이스·계정.", keys: "Ctrl+," },
        { title: "기능 둘러보기", body: "이 둘러보기들을 다시 보는 곳입니다.", keys: "F1" },
      ],
    },
    T2: {
      name: "기록·보기·요약·내보내기",
      time: "1분",
      steps: [
        {
          title: "주 넘기기",
          body: "◀ ▶로 지난주·다음 주, [오늘]로 이번 주.",
          keys: "Alt+← · Alt+→ · Alt+T",
        },
        {
          title: "칸에 기록",
          body: "Enter 새 항목, Tab·Shift+Tab 세부 항목 들이기·내기. 항목 왼쪽 ⋮⋮를 끌어 옮깁니다.",
          keys: "Enter · Tab",
        },
        {
          title: "항목 도구",
          body: "★ 중요 · ⏳ 마감 · ⏰ 시작 시각 · ↻ 매주 반복 · 완료 표시. 왼쪽 손잡이 메뉴나 단축키로.",
          keys: "Alt+I · Alt+U · Alt+O · Alt+R",
        },
        { title: "찾기", body: "업무·메모·자료를 한꺼번에 검색합니다.", keys: "Ctrl+Shift+F" },
        { title: "태그로 거르기", body: "#태그를 붙인 항목만 골라 봅니다." },
        { title: "주간 / 데일리", body: "한 주 전체 또는 하루만 크게.", keys: "Alt+V" },
        { title: "연간 보기", body: "기록이 있는 주를 달력으로.", keys: "Alt+Y" },
        { title: "주간 요약", body: "업무별 자동 정리 · 수정본 · AI 지시문 복사.", keys: "Alt+S" },
        { title: "내보내기", body: "범위와 시트(주간 요약 시트 포함)를 골라 엑셀로.", keys: "Alt+E" },
      ],
    },
    T3: {
      name: "주간 메모 보드",
      time: "50초",
      steps: [
        {
          title: "이번 주 메모",
          body: "주마다 자유 보드 하나. 빈 곳을 누르면 글 상자가 생깁니다.",
          keys: "Alt+M",
        },
        {
          title: "도구 팔레트",
          body: "글 상자·링크 카드·이미지, 객체 복사·붙여넣기.",
          keys: "Ctrl+Alt+C · Ctrl+Alt+V",
        },
        {
          title: "업무 항목과 연결",
          body: "상자를 주간 보드 칸의 항목에 끌어 놓으면 위쪽 띠로 이어집니다.",
        },
        { title: "관계선", body: "상자의 연결점을 끌어 다른 상자에 놓으면 관계선이 생깁니다." },
        { title: "보기", body: "확대·축소·맞춤·관계선 보기." },
        { title: "그림으로 저장", body: "보드를 PNG로 저장·복사하거나 Markdown으로 내보냅니다." },
      ],
    },
    T4: {
      name: "칸반 보드",
      time: "40초",
      steps: [
        { title: "칸반 열기", body: "왼쪽 메뉴의 칸반 아이콘을 눌러 보세요.", keys: "Alt+6" },
        { title: "항목이 카드로", body: "주간 보드에 적은 항목이 카드가 됩니다. TODO · 사용자 섹션 · DONE." },
        {
          title: "끌어서 상태 바꾸기",
          body: "카드를 다른 열로 끌면 상태가 바뀝니다. DONE이면 세부까지 완료.",
        },
        { title: "카드 추가", body: "업무·시작·마감을 정해 바로 추가합니다." },
        { title: "섹션 추가", body: "진행·검토 같은 나만의 단계를 만듭니다." },
        { title: "기간·업무 거르기", body: "이번 주·여러 주·전체, 업무 하나 또는 여러 개." },
        { title: "배치", body: "열을 균등하게 또는 자유롭게 배치합니다." },
      ],
    },
    T5: {
      name: "인사이트",
      time: "40초",
      steps: [
        { title: "인사이트 열기", body: "왼쪽 메뉴의 인사이트 아이콘을 눌러 보세요.", keys: "Alt+3" },
        { title: "두 가지 보기", body: "업무 타임라인과 활동(히트맵)." },
        { title: "업무 고르기", body: "왼쪽에서 업무를 고르면 오른쪽에 그 흐름이 나옵니다." },
        { title: "경과 지도", body: "한 칸 = 한 주, 색이 짙을수록 기록이 많은 주. 누르면 그 주로." },
        {
          title: "업무 타임라인",
          body: "월 → 주 → 요일로 묶어 보여 주고, 다른 날 끝낸 항목은 실제 완료일에.",
        },
        { title: "기간", body: "최근 4주·12주·올해·전체·직접 지정." },
        { title: "경과 복사", body: "보고서에 붙일 글로 복사합니다." },
      ],
    },
    T6: {
      name: "Universe — 개념과 보기 모드",
      time: "1분",
      steps: [
        {
          title: "기록이 이어진 지도",
          body: "업무·항목·메모·자료·지식 카드가 별, 연결이 선입니다. 흩어진 기록의 관계를 한눈에 봐요.",
        },
        { title: "Universe 열기", body: "왼쪽 메뉴의 Universe 아이콘을 눌러 보세요.", keys: "Alt+5" },
        { title: "지도", body: "별을 누르면 상세, 두 번 누르면 그 별이 가운데로 옵니다." },
        { title: "3D / 2D", body: "다이나믹 3D는 끌어서 회전·확대, 정적 2D는 가볍고 또렷하게." },
        { title: "초점 / 은하", body: "한 별 주변만 보거나 전체 은하를 봅니다. 확대·축소로도 넘어가요." },
        { title: "지도 / 목록", body: "같은 연결을 목록으로 봅니다." },
        { title: "필터·상세", body: "종류·업무·태그로 좁히고, 고른 별의 상세와 연결을 봅니다." },
        { title: "시간 막대", body: "년·월·주·일로 기간을 좁힙니다." },
        { title: "자동 움직임", body: "떠다니기·궤도 회전·멈춤." },
        { title: "근거 묶음", body: "고른 근거를 외부 AI에 붙여 넣을 글로 모읍니다." },
      ],
    },
    T7: {
      name: "중요 업무",
      time: "30초",
      steps: [
        { title: "중요 업무", body: "모든 주의 중요 항목을 한곳에 모아 봅니다.", keys: "Alt+2" },
        { title: "패널", body: "왼쪽 패널에 묶음별로 나옵니다. 폭은 경계를 끌어 조절." },
        { title: "마감일이 있는 업무", body: "마감 임박순. 지난 것은 빨갛게 표시됩니다." },
        { title: "항목 줄", body: "체크 = 완료, 줄을 누르면 그 칸으로 이동합니다." },
        { title: "이 주 완료", body: "이번 주에 처리한 중요 업무가 모입니다." },
        {
          title: "중요 업무에 넣기",
          body: "항목의 ☆를 누르거나 Alt+I. 마감일(Alt+U)을 정하면 마감 묶음에 들어갑니다.",
          keys: "Alt+I · Alt+U",
        },
      ],
    },
    T8: {
      name: "Cabi.NET — 자료·노트·업무 보드",
      time: "50초",
      steps: [
        { title: "Cabi.NET 열기", body: "왼쪽 메뉴의 Cabi.NET 아이콘을 눌러 보세요.", keys: "Alt+4" },
        { title: "업무별 작업 공간", body: "폴더·링크·노트·업무 보드를 업무마다 모읍니다." },
        { title: "업무 목록", body: "업무를 고르면 그 업무의 자료만. 자료를 업무에 끌면 그 업무에도 연결." },
        { title: "자료 목록", body: "두 번 누르면 폴더 창·링크 열기." },
        {
          title: "폴더·링크 등록",
          body: "[+ 폴더…]·[+ 링크…], 또는 탐색기의 폴더·브라우저 주소를 끌어 놓기.",
        },
        { title: "새 노트", body: "블록 노트 — / 메뉴·이끌이로 정리, Markdown·PDF 내보내기." },
        { title: "업무 보드", body: "업무당 하나의 자유 보드. Live Widget으로 경과·타임라인을 붙입니다." },
      ],
    },
    T9: {
      name: "업무노트 — 블록으로 쓰는 업무 문서",
      time: "1분",
      steps: [
        {
          title: "업무노트",
          body: "업무에 딸린 문서예요. 회의록·검토 결과처럼 길게 정리할 때 씁니다.",
        },
        { title: "노트 제목", body: "제목은 Cabi.NET 목록과 메모 보드 바로가기에 그대로 보여요." },
        {
          title: "블록으로 쓰기",
          body: "빈 줄 맨 앞에서 /를 누르면 제목·목록·체크·표·인용 메뉴.",
          keys: "/",
        },
        { title: "블록 이끌이", body: "문단 왼쪽 ⠿ — 끌면 순서 바꾸기, 누르면 블록 메뉴." },
        { title: "표", body: "칸 안에서도 / 메뉴. 행·열 손잡이로 옮기고 열 경계를 끌어 너비를 바꿉니다." },
        { title: "이미지·가져오기", body: "그림 넣기, Markdown 파일 가져오기(새 노트 또는 이어 붙이기)." },
        { title: "삭제 잠금", body: "켜 두면 실수로 지우지 않아요." },
        { title: "내보내기", body: "Markdown·PDF 저장, 다른 업무로 옮기기, 복제, 삭제." },
        { title: "목차·넓게 보기", body: "제목으로 목차를 만들고, 넓은 화면으로 펼칩니다." },
        {
          title: "메모 보드에 붙이기",
          body: "Cabi.NET 목록의 노트를 주간 메모 보드에 끌어 놓으면 제목만 보이는 바로가기가 됩니다.",
        },
      ],
    },
    T10: {
      name: "업무 메모보드 — 업무마다 하나의 자유 보드",
      time: "1분",
      steps: [
        {
          title: "업무 메모보드",
          body: "업무마다 하나씩 있는 자유 보드예요. 주간 메모와 달리 기간 없이 계속 쌓입니다.",
        },
        { title: "보드", body: "빈 곳을 누르면 글 상자. 끌어서 옮기고, 연결점으로 관계선을 잇습니다." },
        {
          title: "도구 팔레트",
          body: "글 상자·링크·이미지·복사·붙여넣기 — 주간 메모 보드와 같은 도구예요.",
          keys: "Ctrl+Alt+C · Ctrl+Alt+V",
        },
        {
          title: "Live Widget",
          body: "업무 경과일·업무 타임라인·중요 업무 — 일지가 바뀌면 새로 그려집니다.",
        },
        { title: "위젯 설정", body: "⚙에서 기준·기간·표현(기록·마일스톤·주간)을 바꿉니다." },
        { title: "자료함", body: "이 업무의 폴더·링크·노트 — 보드로 끌어 카드로 붙입니다." },
        { title: "주간 메모 모아보기", body: "눌러 보세요 — 이 업무 항목과 연결된 주간 메모를 모아 봅니다." },
        {
          title: "원본 연결·사본",
          body: "고른 메모를 원본 연결(최신 내용) 또는 독립 사본으로 보드에 더합니다.",
        },
        { title: "내보내기", body: "보드를 Markdown이나 PNG 그림으로 저장합니다." },
      ],
    },
  } satisfies Record<TourId, { name: string; time: string; steps: StepText[] }>,
};
