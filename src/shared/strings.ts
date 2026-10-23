// UI 문자열의 단일 출처. 화면 컴포넌트에 한국어 문구를 직접 쓰지 않는다(공통 규칙 4절).
export const STR = {
  appName: "Work Journey Board",
  topBar: {
    settings: "설정",
    settingsPending: "설정 화면은 준비 중입니다",
  },
  status: {
    loading: "불러오는 중…",
    dbReady: (version: string, label: string) => `SQLite ${version} · ${label}`,
    dbNotConfigured: "저장 폴더가 아직 설정되지 않았습니다",
    dbError: (message: string) => `데이터를 열지 못했습니다: ${message}`,
  },
  board: {
    placeholder: "주간 보드가 여기에 표시됩니다.",
  },
} as const;
