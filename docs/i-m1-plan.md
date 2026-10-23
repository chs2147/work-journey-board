# I-M1 핵심 기록 — 구현 계획

> 작성: 2026-10-23 · 상위: [project-plan.md](project-plan.md) I-M1 · 전제: ◆G1 GO([overview.md](overview.md) 13절)
> 스펙: overview 10절(화면) · [data-spec.md](data-spec.md) · 와이어프레임 [주간 보드](wireframes/wireframe-weekly-board.svg) · [첫 실행](wireframes/wireframe-first-run.svg)
> **목표**: 이것만으로 매일 쓸 수 있는 최소 완성품 → 회사 PC 설치 → **◆G2 2주 실사용** 진입.

---

## 0. 범위

### 0-1. 포함 (project-plan I-M1 작업 1~7)
| # | 기능 | 스펙 |
|---|---|---|
| 1 | 첫 실행: 저장 폴더 선택(OneDrive 경고) → DB 생성 / 기존 일지 열기 → 첫 업무 만들기 | overview 10-8 |
| 2 | 주간 보드: 포커스 열 격자, 이번 주·오늘 진입, ◀ ▶·오늘·연간 미니맵 | 10-1·10-2 |
| 3 | 업무: 추가·이름·색·순서·종료·재활성·빈 업무 삭제, 자동 이월(계산), 3주 무기록 배지 | 10-4, data-spec 4·5 |
| 4 | 개조식 입력: 키보드 규칙 전체, 붙여넣기 분해, 자동 저장, 실행 취소 | 10-3, data-spec 2·6 |
| 5 | 일일 메모 행 | 10-5 |
| 6 | 토·일 좁은 열(기록 시 확장) | 10-6 |
| 7 | 자동 롤링 백업 + "지금 백업", 시작 시 무결성 검사 | data-spec 7 |
| + | 설정 화면(저장 폴더·백업·업무 관리·무기록 기준), 저장 상태 표시·토스트 | 10-9 |

### 0-2. 제외 (뒤 마일스톤)
- 주간 요약 패널 → **M2** (M1에서는 상단 [주간 요약]·[내보내기]·[인사이트] 버튼을 숨김. 자리만 남기지 않는다 — 누르면 아무것도 없는 버튼은 실사용 마찰)
- 엑셀 내보내기 → M2 / 시각화 → M3 / AI → M4 / 백업 **복원 UI** → M5(그 전까지 복원은 파일 복사 안내로)

### 0-3. 완료 기준
- [ ] overview 10절·data-spec의 M1 해당 규칙을 모두 충족(각 세션 체크리스트 전부 ✅)
- [ ] 키보드만으로 "앱 열기 → 오늘 칸 3업무 × 항목 2개 + 메모 1줄" **2분 이내**(E2E로 조작 수 측정 + 회사 PC에서 실측)
- [ ] 회사 PC에 `v0.1.0` 설치 → 실제 사용 시작 → ◆G2

---

## 1. 세션 분할 (5세션)

| 세션 | 내용 | 산출물 | 어디서 확인 |
|---|---|---|---|
| **S1** | 프로젝트 골격 + CI + 윈도우 빌드 | 빈 앱이 브라우저·윈도우 양쪽에서 뜸 | 클라우드 + Actions 산출물 |
| **S2** | 도메인 + 데이터 계층 | `week`·`categories`·`nudge`, SqlDriver(sql.js)·마이그레이션·Repository·백업 로직, 단위 테스트 | 클라우드(테스트) |
| **S3** | 보드 화면 + 개조식 입력 | 주간 보드 전체(입력·업무 행·메모·주말·네비게이션·미니맵) | 클라우드(브라우저 모드 + Playwright 스크린샷) |
| **S4** | 플랫폼 연결 + 첫 실행 + 설정 + 백업 동작 | Tauri 드라이버·폴더 선택·OneDrive 감지·config·백업 스케줄·설정 화면 | 클라우드 + 윈도우 빌드 |
| **S5** | 통합 검증 + `v0.1.0` 릴리스 | E2E 시나리오, 회사 PC 확인표, G2 마찰 기록 양식 | 회사 PC |

> 각 세션 끝: 테스트 통과 → 커밋·`main` 반영(사용자 확인) → 다음 세션 시작 프롬프트를 이 문서 5절에서 복사.

---

## 2. 세션별 상세

### S1. 프로젝트 골격
**만들 것**
- 루트에 앱 프로젝트(`m0/`는 그대로 두고 참고용): `package.json`(개발 버전 `0.0.x` — `0.1.0`은 M1 완성(S5)용으로 남겨 둠), React 18 + Vite + TS strict, ESLint + Prettier, Vitest, Playwright.
- `src/` 디렉토리 구조(CLAUDE.md 3절) 빈 모듈 + `shared/tokens.css`(라이트/다크 토큰, 글꼴 맑은 고딕) + `shared/strings.ts` + `shared/palette.ts`(c1~c8, viz-spec 6절 값).
- `src-tauri/`: Tauri v2, 플러그인 sql·dialog·clipboard-manager·single-instance·opener·window-state 등록, CSP(외부 연결 차단), NSIS `currentUser`, WebView2 `embedBootstrapper`, 식별자 `com.chs2147.workjourneyboard`, 표시 이름 `Work Journey Board`.
- `.github/workflows/ci.yml`(ubuntu: lint·typecheck·test·e2e, PR·main).
- `.github/workflows/build-windows.yml`(windows-latest):
  - main 푸시 시 NSIS 빌드 → `v<package.json 버전>` **사전 릴리스 생성·갱신**(태그는 워크플로가 생성, M0 방식).
  - 수동 실행 입력 `webview: embed | offline` → `offline`이면 `--config`로 `offlineInstaller` 설치판을 별도 파일명(`…_setup_offline.exe`)으로 같은 릴리스에 추가.
- 브라우저 모드 진입점: `npm run dev` = sql.js 메모리 DB + `fixtures/sample-weeks.json` 시드(가상 데이터, output-spec 1절 샘플 기반).

**완료 체크**
- [ ] `npm run dev`로 빈 화면 + 상단 바 표시, `npm test`·`npm run e2e`·lint·typecheck 통과
- [ ] Actions 윈도우 빌드 성공, 릴리스 `v0.0.1`(사전)에 설치 파일 첨부
- [ ] 앱 코드에 외부 호스트 접근 없음(CSP 확인, 의존성 목록 점검)

### S2. 도메인 + 데이터 계층
**domain (순수 함수, 100% 단위 테스트)**
- `week.ts`: ISO 주차 ID·월~일 범위·보드 제목 표기(해 넘김 포함)·연간 주 목록(월 배치는 목요일 기준). 경계 테스트 10건(data-spec 1-3).
- `categories.ts`: 주 W 표시 업무 + 표시 상태(진행/이 주 중 종료/기록만), 추가 시 시작일(보고 있는 주 월요일), 재활성 규칙(4-3).
- `nudge.ts`: 무기록 판정(휴가 주 제외·유예·유지 N주·이번 주 기록 시 미표시·0=끔)(5절).
- `items.ts`: 셀 항목 목록 조작(추가·깊이 변경·순서 이동 시 세부 항목 동반·첫 항목 depth 0 보장·붙여넣기 분해 파서).
- `localTime.ts`: 백업·파일명용 **로컬 시각** 포맷(overview 13-3 #3).

**data**
- `driver.ts`(SqlDriver), `drivers/sqlJs.ts`, `migrations/0001_init.sql`(data-spec 3-2 그대로), 마이그레이션 실행기(직전 백업 훅·상위 버전 거부).
- `repository.ts`: `getWeek`·`saveCell`(id 기준 upsert + 빠진 id 삭제, 트랜잭션)·`saveMemo`·업무 CRUD·`getNudges`·`getYearDensity`(미니맵용 주별 기록 일수).
- `backup.ts`: `VACUUM INTO` 일일/월간/수동 파일명, 롤링 삭제(**두 패턴만**), 사본 `quick_check`.

**완료 체크** (2026-10-23 완료)
- [x] data-spec 9절 체크리스트 전 항목 테스트 통과(sql.js 위에서 실제 SQL) — 단위 테스트 82개
- [x] 롤링 삭제가 패턴 외 파일(수동·마이그레이션·임의 파일)을 지우지 않는 테스트
- [x] 연결 시 `foreign_keys=ON`(sqlx 기본값·sql.js 설정)·`journal_mode=DELETE` 확인. `synchronous`는 SQLite 기본값 FULL(비-WAL) 그대로
- [x] **추가 발견·해결**: 실앱 연결 풀에서 실패한 트랜잭션이 이후 쓰기를 모두 막는 문제 → Rust `db_batch`(sqlx Transaction)로 해결, 실제 Tauri 앱에서 실패 배치 롤백 + 후속 쓰기 정상 확인

### S3. 보드 화면 + 개조식 입력 (M1의 핵심 — 가장 오래 걸림)
**구성요소**
- `TopBar`: 앱 이름 · ◀ 주차 제목 ▶ · [오늘] · [연간 보기] · 저장 상태(`저장됨 ✓`/`저장 중…`/`저장 실패 — 다시 시도`) · [⚙].
- `WeekGrid`: 열 폭 규칙(포커스 2fr·평일 1fr·주말 40px, 기록 있으면 1fr), 오늘 열 강조, 열 머리 클릭 → 포커스.
- `CategoryRowHeader`: 색 점·이름(더블클릭 편집)·`⋯` 메뉴(이름·색 8개·위/아래·종료·삭제(기록 0건만))·끌어서 순서·**무기록 배지 [종료][유지]**·종료됨 흐림 표시.
- `CellEditor`: 개조식 입력기 — overview 10-3 키 표 전부, 붙여넣기 분해, 0.5초 디바운스 + blur 저장, 포커스 열 빈 칸 `+ 기록 추가`.
- `AddCategoryRow`, `MemoRow`(1단 입력기).
- `YearMinimap` 팝오버(월별 행, 5단계 색, 이번 주 테두리, 연도 이동).
- `Toast`(종료됨 [되돌리기], 항목 삭제됨 [되돌리기] 5초), `UndoStack`(50단계, Ctrl+Z/Y).
- 시작 시 커서: 이번 주 · 오늘 열 · 첫 업무 칸.

**완료 체크** (2026-10-23 완료 — E2E 12개, 3회 반복 실행 전부 통과)
- [x] 10-3 키 표의 모든 키를 Playwright로 검증(Enter·Shift+Enter·Tab/Shift+Tab·빈 항목 Backspace·Alt+↑↓·칸 경계 ↑↓·Esc·Ctrl+Z/Y)
- [x] 붙여넣기: `-`·`•`·`*`·`·`·`○`·`1.`·`1)` 접두어 제거, 들여쓴 줄 → 세부
- [x] 단축키: Alt+←/→, Alt+T, Alt+Y, Ctrl+←/→ (한국어 자판 대응 위해 `e.code`로 판별)
- [x] 주말 열 자동 확장, 과거 주 업무 추가, 종료 후 다음 주에서 사라짐, 재활성(종료 토스트 [되돌리기]; 설정 화면의 재활성은 S4)
- [x] 와이어프레임과 나란히 비교한 스크린샷(라이트/다크)
- [x] **2분 시나리오** E2E: 빈 일지 → 업무 3개 + 항목 6개 + 메모, 글자 외 조작 키 12회
- [x] 한글 IME: 조합 중 Enter·Tab 무시(CDP로 조합 상태 재현). **실제 윈도우 한글 입력기 확인은 S5 회사 PC 확인표에 포함**
- [ ] 무기록 제안 배지: 판정 로직은 단위 테스트 완료, 화면 표시는 샘플 데이터로 재현이 안 돼 S5 통합 시나리오에서 확인

### S4. 플랫폼 연결 + 첫 실행 + 설정 + 백업 동작
- `platform/index.ts` 인터페이스: `pickFolder` · `getConfig/setConfig`(dataDir) · `isOneDrivePath` · `openFolder` · `onAppExit`.
  - `tauri.ts`: plugin-sql 드라이버, dialog, **얇은 Rust 커맨드 2개**(OneDrive 환경 변수 읽기, `%LOCALAPPDATA%\WorkJourneyBoard\config.json` 읽기/쓰기 — plugin-store는 Roaming 폴더를 써서 미사용).
  - `browser.ts`: 메모리 DB + 샘플, 폴더 선택은 가짜 경로.
- 첫 실행 3단계(와이어프레임), 폴더에 기존 `work-journey.db`가 있으면 열기 분기, 추천 폴더 `C:\Users\<사용자>\WorkJourney`.
- 앱 시작: config 확인 → DB 열기 → `quick_check` → 마이그레이션 → 오늘 첫 실행이면 일일·월간 백업 → 보드.
- 앱 종료: 같은 날짜 일일 백업 덮어쓰기(종료 이벤트에서 완료를 기다린 뒤 닫힘).
- 저장 폴더 사라짐(USB·네트워크 드라이브 등): "저장 폴더를 찾을 수 없습니다 — [다시 시도] [다른 폴더 선택]" 화면(쓰기 시도 금지).
- 설정 화면: **저장 위치**(경로·[폴더 열기]·[저장 위치 변경…] — overview 10-10의 분기·옮기기 순서·실패 처리 그대로), 백업(마지막 시각·[지금 백업]·[백업 폴더 열기]), 업무 관리(종료된 업무 [다시 시작]), 무기록 기준 주 수(0·2~8).
- single-instance: 두 번째 실행 시 기존 창을 앞으로.

**완료 체크** (2026-10-23 — 단위 92개, E2E 24개 2회 반복 통과, 리눅스 실앱 확인)
- [x] 첫 실행 → OneDrive 경고 → 다른 폴더 → 보드: 브라우저 모드 E2E로 확인. **윈도우 실기(폴더 대화상자·실제 OneDrive 경로)는 S5 회사 PC 확인표**
- [x] 백업 파일명이 로컬 시각, 일일 14·월간 12 롤링 — 단위 테스트 + 리눅스 실앱에서 실제 파일 생성 확인(임시 파일 남지 않음, 같은 날 두 번째 실행은 백업 건너뜀)
- [x] 저장 폴더 없음 화면(실앱 확인, 폴더를 새로 만들지 않음). 두 번째 실행 시 기존 창 활성은 S1의 single-instance 설정 — 윈도우 실기 확인은 S5
- [x] 저장 위치 변경 4분기 + 옮기기 실패 시 기존 위치 유지(대상에 일지가 있으면 덮어쓰지 않고 실패) + 원본 보존 테스트
- [x] 종료 직전 대기 중인 입력 저장 + 종료 백업(브라우저 모드 E2E). **실앱 창 닫기 → 종료 백업은 리눅스 화면 없는 환경에서 창을 정상 종료시킬 수 없어 S5 회사 PC에서 확인**
- 구현 메모: 파일 동작은 Rust `src-tauri/src/files.rs`의 얇은 명령(설정 읽기/쓰기·OneDrive 루트·목록·폴더 만들기·백업 이름 바꾸기·백업 삭제·새 파일 복사·폴더 열기). 백업 삭제·이름 바꾸기는 Rust에서도 이름 패턴을 다시 검사(이중 가드). 브라우저 모드는 `src/platform/fakeFs.ts`(메모리 가짜 폴더)로 같은 흐름을 시험

### S5. 통합 검증 + `v0.1.0`
- E2E 시나리오 묶음(브라우저 모드): 첫 실행 → 업무 3개 → 1주 기록 → 다음 주 이월 확인 → 3주 비우고 배지 → 종료·재활성 → 실행 취소.
- 버전 `0.1.0` 확정(사용자 확인) → README Version History 기록 → main 반영 → 릴리스 자동 생성.
- **회사 PC 확인표**(`docs/m1-check.md` 신설): 설치(업데이트 설치 시 기존 M0 앱과 별개 확인), 첫 실행, `D:\` 폴더 사용, 하루 기록 2분 측정, 백업 파일 생성, 재부팅 후 재실행(M0 미확인 항목 포함).
- **G2 마찰 기록 양식**(`docs/g2-log.md`): 날짜 · 기록 소요(분) · 불편했던 순간 · 바로 고칠 것/나중. 업무 내용은 적지 않는다(공개 저장소).

---

## 3. 데이터 안전 (실사용 시작 전 필수)
- G2부터 **실제 업무 기록이 회사 PC에 쌓인다** → S4의 백업이 M1 필수 범위(M5로 미루지 않음).
- 실제 DB 파일은 저장소·클라우드 세션에 절대 넣지 않는다. 버그 재현은 증상 설명 + 가상 데이터로.
- M1 이후 스키마를 바꾸는 업데이트는 마이그레이션 직전 자동 백업이 반드시 돌아야 배포한다.

## 4. 리스크
| 리스크 | 대응 |
|---|---|
| 개조식 입력기가 `contenteditable` 계열 버그(커서 튐·IME 한글 조합 깨짐)에 빠짐 | 항목마다 **`<textarea>` 1개**(자동 높이)로 구현, 셀은 항목 목록. 한글 IME 조합 중(`isComposing`) Enter·Tab 처리 보류 — S3 첫 작업으로 검증 |
| WebKitGTK(클라우드)와 WebView2(회사)의 키 이벤트 차이 | 키 처리 E2E는 Chromium(Playwright)으로 — WebView2와 같은 엔진 계열 |
| 자동 저장과 실행 취소 충돌 | 실행 취소는 메모리 상태를 되돌린 뒤 같은 `saveCell` 경로로 저장(별도 경로 없음) |
| 2분 목표 미달 | S3 끝에 E2E로 조작 수 측정, S5 회사 PC 실측, G2에서 마찰 목록으로 M2 전에 수정 |

## 5. 세션 시작 프롬프트
```
[S1] work-journey-board 저장소에서 I-M1 S1(프로젝트 골격)을 진행하자.
CLAUDE.md, docs/i-m1-plan.md 2절 S1, docs/overview.md 13-4절을 읽고
React+Vite+TS 앱 골격, Tauri v2 껍데기, ci.yml, build-windows.yml(embed/offline)을 만들어줘.

[S2] work-journey-board 저장소에서 I-M1 S2(도메인+데이터 계층)를 진행하자.
docs/i-m1-plan.md S2와 docs/data-spec.md 전체를 읽고 domain·data 모듈과 테스트를 작성해줘.

[S3] work-journey-board 저장소에서 I-M1 S3(보드 화면+개조식 입력)을 진행하자.
docs/i-m1-plan.md S3, docs/overview.md 10절, docs/wireframes/wireframe-weekly-board.svg를 읽고
textarea 기반 입력기부터 한글 IME 검증 후 보드 전체를 구현해줘.

[S4] work-journey-board 저장소에서 I-M1 S4(플랫폼·첫 실행·설정·백업)를 진행하자.
docs/i-m1-plan.md S4, docs/overview.md 10-8절, docs/data-spec.md 7절을 읽고 구현해줘.

[S5] work-journey-board 저장소에서 I-M1 S5(통합 검증·v0.1.0)를 진행하자.
docs/i-m1-plan.md S5를 읽고 E2E 시나리오, m1-check.md, g2-log.md를 만들고 릴리스를 준비해줘.
```
