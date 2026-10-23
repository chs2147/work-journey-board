# Work Journey Board

요일 단위 주간 보드에 업무별로 개조식 기록을 남기면 **주간 요약 · 진행 경과 시각화 · 엑셀 보고서**가 자동으로 만들어지는 개인 업무 일지.
회사 윈도우 PC 단독 사용, **외부 통신 0**, 데이터는 사용자가 고른 폴더의 SQLite 파일 1개.

> 본질: **입력은 최대한 가볍게, 산출물은 자동으로.**

## 상태
- 상세설계 D1~D5 완료(2026-10-22) — 설계 저장소 [my-discussions](https://github.com/chs2147/my-discussions)에서 이 저장소로 이관. **이후 정본은 이 저장소.**
- **I-M0 완료 · ◆G1 GO**(2026-10-23): 회사 PC에서 관리자 권한 없이 설치·실행, WebView2 있음, 사용자 폴더 SQLite 전 항목 통과 → Tauri 구조 확정 ([docs/overview.md 13절](docs/overview.md))
- 다음: **I-M1 핵심 기록** — 계획 [docs/i-m1-plan.md](docs/i-m1-plan.md) (S1 골격 → S2 도메인·데이터 → S3 보드·입력 → S4 플랫폼·첫 실행·백업 → S5 검증·v0.1.0)

## 문서
| 문서 | 내용 |
|---|---|
| [docs/overview.md](docs/overview.md) | 요구사항(R1~R10) · 설계 결정 이력 · **화면 구성(10절)** · 상세 설계 요약(11절) · **인계 명세(12절)** |
| [docs/data-spec.md](docs/data-spec.md) | ISO 주차 · 스키마 SQL · 카테고리 활성/무기록 규칙 · 삭제 · 백업 · 저장소 인터페이스 |
| [docs/output-spec.md](docs/output-spec.md) | 주간 자동 집계 · 엑셀 2시트 양식 · 내보내기 UX · AI 클립보드 지시문 |
| [docs/viz-spec.md](docs/viz-spec.md) | 경과 타임라인 · 활동 히트맵 · 기간 막대 · 주별 비중 · 업무 색 팔레트 |
| [docs/m0-install-check.md](docs/m0-install-check.md) | I-M0 회사 PC 설치 검증 절차 · ◆G1 판정 기준 |
| [docs/splash-spec.md](docs/splash-spec.md) | 시작 스플래시 구현 스펙 · 시안 3종(B 확정) |
| [docs/i-m1-plan.md](docs/i-m1-plan.md) | I-M1 핵심 기록 구현 계획(세션 S1~S5) |
| [docs/project-plan.md](docs/project-plan.md) | 작업 패키지 · 관문(G1/G2) · 마일스톤 I-M0~M5 · 세션 시작 프롬프트 |
| [docs/wireframes/](docs/wireframes/) | 주간 보드 · 첫 실행/연간 보기 · 인사이트 · 스플래시 와이어프레임 |
| [docs/samples/](docs/samples/) | 엑셀 내보내기 샘플(가상 데이터) |
| [CLAUDE.md](CLAUDE.md) | 구현 규칙(외부 통신 0 · 실데이터 금지 · 데이터 파일 안전 · 기술 스택) |

![주간 보드 와이어프레임](docs/wireframes/wireframe-weekly-board.svg)

## 기술 스택 (확정)
Tauri v2(NSIS per-user) · React 18 + Vite + TypeScript · SQLite(실앱 tauri-plugin-sql / 개발·테스트 sql.js) · ExcelJS · SVG + d3-scale · date-fns · Vitest + Playwright · GitHub Actions(ubuntu CI + windows-latest 설치 파일 빌드)

## 사용한 글꼴
- [Pretendard](https://github.com/orioncactus/pretendard) — SIL Open Font License 1.1, 공식 배포 파일을 수정 없이 포함 ([라이선스 전문](public/licenses/Pretendard-OFL-1.1.txt))

## 개발
```bash
npm ci
npm run dev          # 브라우저 모드(sql.js 메모리) — http://localhost:1420
npm test             # 단위 테스트(Vitest)
npm run e2e          # E2E(Playwright, 브라우저 모드)
npm run lint && npm run format:check && npm run typecheck
npm run tauri dev    # 실앱 모드(윈도우 / 리눅스는 webkit2gtk-4.1 필요)
```
- 브라우저 모드 주소 옵션(E2E·시연): `?today=YYYY-MM-DD` 오늘 고정 · `?empty=1` 빈 일지 · `?fresh=1` 첫 실행 화면 · `?existing=/경로` 그 폴더에 샘플 일지 준비 · `?config=/경로` 설정 폴더 지정(없는 폴더면 "저장 폴더를 찾을 수 없음")
- 윈도우 설치 파일: `main`에 반영되면 [Releases](https://github.com/chs2147/work-journey-board/releases)에 `v<버전>` 사전 릴리스로 올라간다. WebView2 오프라인 설치판은 Actions → *Build Windows installer* → Run workflow → `offline`.

## Version History
### v0.0.6 (2026-10-23) — 시작 스플래시
- 앱을 켜면 보드가 준비될 때까지 "한 주가 채워지는 보드" 스플래시 표시(월~금 카드에 기록 줄이 차례로 그려지고 오늘 요일 강조)
- 흰 화면 깜빡임 제거(창 배경색 = 스플래시 배경, OS 다크 테마면 다크 배경)
- 준비 + 보드 글꼴 로딩이 끝나면 바로 사라짐(최소 0.4초), 3초 넘으면 진행 문구 표시, 애니메이션 효과 끔 설정 존중

### v0.0.5 (2026-10-23) — 본문 글꼴 Pretendard 14px
- 본문 글꼴을 Pretendard Variable(SIL OFL 1.1)로 변경 — 공식 woff2를 수정 없이 앱에 포함, 라이선스 전문 동봉(외부 통신 없음)
- 기본 글자 크기 13px → 14px(작은·큰 글자도 함께 한 단계씩)
- 버그 수정: 글꼴 로딩 후·칸 폭이 바뀔 때 입력칸 높이를 다시 재서 글자가 잘리거나 빈 줄이 남지 않게 함
- 빌드 워크플로: public/ 변경도 윈도우 빌드 대상에 포함

### v0.0.4 (2026-10-23) — I-M1 S4 첫 실행·저장 위치·설정·자동 백업 (회사 PC에서 기록 가능한 첫 버전)
- 첫 실행 3단계: 새로 시작/기존 일지 열기, 저장 폴더 선택(OneDrive 폴더 경고, 기존 일지 감지), 첫 업무 입력
- 시작 시 저장 폴더 없음·데이터 파일 이상 안내 화면
- 설정: 저장 위치 변경(같은 폴더·OneDrive 경고·다른 일지로 전환·빈 폴더로 옮기기, 원본 보존), 지금 백업·마지막 백업, 종료된 업무 다시 시작, 무기록 종료 제안 기준, 버전
- 자동 백업: 그날 첫 실행 시 일일·월간, 종료 시 일일 덮어쓰기, 종료 직전 미저장 입력 저장
- 백업 삭제·이름 바꾸기는 Rust 쪽에서도 파일 이름 패턴 재검사(이중 가드)
### v0.0.3 (2026-10-23) — I-M1 S3 주간 보드 화면·개조식 입력
- 포커스 열 주간 보드(오늘 열 넓게, 빈 토·일 좁게·기록 있으면 확장), 연간 미니맵, 주 이동·오늘 단축키
- 개조식 입력: 키보드 규칙 전체(Enter·Tab·Backspace·Alt+↑↓·칸 경계 ↑↓), 여러 줄 붙여넣기 분해, 한글 조합 중 키 무시
- 자동 저장(0.5초·칸 이동 시)과 저장 상태 표시, 실행 취소·다시 실행(50단계), 삭제·종료 되돌리기 알림
- 업무 관리(이름·색·순서·끌기·종료·빈 업무 삭제·무기록 배지·연속 추가), 일일 메모 행(여러 줄)
### v0.0.2 (2026-10-23) — I-M1 S2 도메인·데이터 계층
- 주차 계산(ISO, 53주 연도·해 넘김 제목), 업무 주별 표시 상태·종료·재활성, 3주 무기록 종료 제안 규칙
- 개조식 항목 처리(빈 항목 정리·붙여넣기 분해·들여쓰기·세부 항목 동반 이동)
- 스키마 v1 마이그레이션과 저장소(주간 보드·셀 저장·메모·업무 관리·설정·연간 밀도)
- 백업: VACUUM INTO 후 검증, 일일·월간·수동·마이그레이션 직전, 로컬 시각 파일명, 패턴 한정 롤링 삭제
- 실앱 트랜잭션을 Rust `db_batch`(sqlx Transaction)로 처리 — 실패 시 자동 롤백, 이후 저장 정상
### v0.0.1 (2026-10-23) — I-M1 S1 프로젝트 골격
- React 18 + Vite + TypeScript 앱 골격, 디자인 토큰·업무 색 팔레트·UI 문자열 단일 출처
- SQL 드라이버 인터페이스 + sql.js(브라우저 모드)·tauri-plugin-sql(실앱) 드라이버
- Tauri v2 껍데기: 단일 인스턴스·창 상태 기억, 외부 통신 차단 CSP, NSIS 현재 사용자 설치, WebView2 embedBootstrapper
- CI(lint·포맷·타입·단위·E2E)와 윈도우 설치 파일 빌드·사전 릴리스 워크플로(오프라인 설치판 선택 가능)
