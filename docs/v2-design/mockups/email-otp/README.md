# 로그인 인증번호 메일 시안(2026-11-17)

Supabase Auth 이메일 템플릿(Magic Link / OTP 본문) 후보 3개. `{{ .Token }}` = 인증번호. 그림 없음·표 레이아웃·인라인 스타일(Gmail·Outlook·애플 메일), 번호 = 고정폭 글꼴 40px 이상.

| 시안 | 파일 | 기준 |
|---|---|---|
| A 종이 일지 | `a-paper.html` | 티저 사이트 시그니처(웜 베이지·클레이) |
| B 잉크 & 시그널 | `b-signal.html` | 산본지니 브랜드 키트(Ink `#17151F`·Signal Orange `#FF6336`·Chalk `#F5F2EC`) |
| C 주간 보드 티켓 | `c-ticket.html` | 앱 주간 보드 요일 줄·오늘 강조, 바이올렛 `#7555F7`은 오늘 칸·표 띠에만 |

비교 페이지: https://claude.ai/artifact/QutrBqP9Dxqsme2LCfS3o8 · 결정 뒤 개발 프로젝트 Auth 템플릿에 적용(운영은 G-2에서 같은 파일).

**결정(2026-11-17 사용자)**: A안 바탕 + B안 인증번호(잉크 46px 고정폭 + 시그널 오렌지 밑줄) → `final-otp.html`. Supabase Auth › Emails › Templates에 붙여 넣는 전체 HTML.
