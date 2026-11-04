# CLAUDE.md — Work Journey Board

> 2026-10-22 설계 저장소 my-discussions(`topics/10 work-journal-board/impl-CLAUDE.md`)에서 작성한 초안을 옮겨왔다. **이후 설계·구현 문서는 이 저장소가 정본이며 my-discussions에는 동기화하지 않는다.**
> 보편 규칙(브랜치 안내·문서 동반 갱신·검증 방법론·UI 기본기·DB 안전 등)은 전역 `~/.claude/CLAUDE.md`(정본: my-discussions `topics/8 common-vibe-coding-rules/common-claude-rules.md`)를 따른다. **이 파일에는 이 프로젝트 고유 규칙만** 둔다.

## 1. 프로젝트 개요
- **Work Journey Board** — 요일 단위 주간 보드에 사용자 정의 업무별로 개조식 기록 → 주간 요약·정성적 경과 시각화·엑셀이 자동으로 나오는 개인 업무 일지.
- 대상: **회사 윈도우 PC** + **macOS**(1.6.0~, macos-spec — 하나의 원본·같은 판·같은 기능), per-user 설치(맥 = DMG로 응용 프로그램 폴더), **외부 통신 0**, 데이터 = 사용자가 고른 폴더의 SQLite 파일 1개.
- 스펙 원본(이 저장소 `docs/`):
  | 문서 | 내용 |
  |---|---|
  | `overview.md` | 요구사항·결정 이력·**10절 화면 구성**·**12절 인계 명세** |
  | `data-spec.md` | 주차 규칙·스키마 SQL·활성/무기록 규칙·삭제·백업·저장소 인터페이스 |
  | `output-spec.md` | 자동 집계 포맷·엑셀 2시트·내보내기·AI 지시문 |
  | `viz-spec.md` | 4개 시각화·업무 색 팔레트 |
  | `splash-spec.md` | 시작 스플래시 창(창 2개 흐름·최소 표시 시간·안전장치·시안) |
  | `important-repeat-spec.md` | 중요 표시(B안)·중요 업무 패널·매주 반복(R1)·왼쪽 메뉴 레일(M1) 상세 설계 |
  | `weekly-note-spec.md` | 주간 메모(요일 메모 → 주 1개 자유 메모: 자유 배치 상자·리치 서식·이미지) 상세 설계 — 2026-10-25 확정(시안 A·메모 도크), 구현 N1~N3 |
  | `improve-1026-spec.md` | 2026-10-26 개선 11건(연차 표시·빈 메모 상자·직전 기록 가져오기·태그/필터·오늘 강조·오늘 뷰·링크·링크 카드·메모 줌) 상세 설계 — 2026-10-26 확정(메모 보드 단추 아이콘 통일 포함), 구현 U1(v0.2.5)~U4(v0.2.8) 완료 |
  | `improve-1026v2-spec.md` | 2026-10-26 개선 v2 10건(행 삭제·묶음 삭제·행 끌어서 옮기기·업무연계 메모·중요 목록 업무명 묶기·보기 아이콘) 상세 설계 — 2026-10-26 추천안 확정, 구현 V1(v0.2.9)·V2(v0.2.10)·V3(v0.2.11) 완료 |
  | `m3-s1-spec.md` | I-M3 S1 인사이트 화면 틀 + 경과 타임라인 상세 설계(들어가기·상단 바·필터·업무 목록·주 행·접기·구간·★/↻/링크/연차/연결 메모 표시·검색·이동·경과 복사·좁은 창·키보드·저장소 조회) — 2026-10-26 확정(경과 지도 추가), 구현 `v0.2.12` |
  | `m3-s2-spec.md` | I-M3 S2 활동 개요 탭 + 활동 히트맵 상세 설계(탭 줄·업무 다중 선택·차트별 범위·12주 일/연간 주 히트맵·모든 업무 행·툴팁·이동·키보드·표로 보기) — 2026-10-26 확정(추천안 14건), 구현 `v0.2.13` |
  | `note-relation-spec.md` | 메모 보드 관계선(상자끼리 둥근 모서리 꺾은선으로 잇기·고치기·해제, 연결점 끌기·`L` 키, 선 도구 막대, 상자 ⋯ 관계선 목록, [관계선 보기]) 상세 설계 — 2026-10-27 확정(#5 꺾은선, 나머지 추천안), 구현 `v0.2.14` |
  | `multi-link-spec.md` | 메모 상자 하나를 여러 업무 항목에 연결(여러 줄 타이틀 띠·줄마다 ✂·끌어 놓기는 "더하기"·행을 상자에·⋯ 항목 고르기·5개 이상 접기, `ref` → `refs`) 상세 설계 — 2026-10-27 확정(추천안 9건), 구현 `v0.2.15` |
  | `improve-1027v3-spec.md` | 2026-10-27 개선 v3 7건(메모 보드 스냅샷 PNG·엑셀 포함, 상자를 항목에 끌 때 제자리·꼬리표, 행을 판 빈 곳/상자에 놓기 다듬기, 배경색 칩 버그, 릴리스 노트 규칙, 중요 업무 날짜 띠, 연결점 4방향) 상세 설계 — 2026-10-27 추천안 확정, 구현 W1(`v0.2.16`, #2~#7)·W2(`v0.2.17`, #1 스냅샷) |
  | `improve-1027v4-spec.md` | 2026-10-27 개선 v4(새 판 확인·설치 — 외부 통신 0 유지 A안 추천/인터넷 B안, 중요 업무 완료 뱃지·메모 상자 ✓, 완료 기록 영구 보관, 보고 있는 주의 완료만) 상세 설계 — 2026-10-27 확정(#1 = B안·실행 시 1번 + 설정 단추, 나머지 추천안), 구현 X1(`v0.2.18`, #2~#4)·X2(`v0.2.19`, #1) |
  | `improve-1027v5-spec.md` | 2026-10-27 디자인 개선 v5(설정 = 레일 맨 아래 ⚙ + 보드 자리 전체 화면·분류 5개, 눈에 띄는 저장됨 알약, 가져오기 단계 표시·진행 순서 상자·AI 지시문 코드 블록, 테마 시스템/라이트/다크) 상세 설계 — 2026-10-27 확정(추천안 + 가져오기 묶음 제목 글상자), 구현 Y1·Y2 함께 `v0.2.20` |
  | `renewal/` | T1 티저 사이트(`site/` → GitHub Pages, 2026-10-27 배포) · T2 디자인 리뉴얼 v1(`design-style-spec.md` 정본 — Warm Beige·고운돋움 시그니처 테마, `design-renewal-v1.md` 기록) — 구현 `v0.3.0` |
  | `optimize-1031-plan.md` | 정식 릴리스 준비 1 — 최적화 점검(데이터 로딩·주 전환 조회, 백업·복구 빈틈, 1년치 일지 메모리 증가 측정: 원인 = 메모 이미지 `data:` 그리기) 개선 상세 계획 O1~O6 — 2026-11-01 추천안 확정(이미지 = canvas 표시 크기, 주기 백업 2시간, 복원 규칙 확장, 보조 백업 위치 기본 꺼짐, 메모리 검사 CI main만), O1~O6 구현(6절 기록) · `v0.3.0` 보존 브랜치 `pre-0.3.0` |
  | `release-phase2-spec.md` | 정식 릴리스 준비 2 — 시그니처 기본값(첫 설치)·테마 순서·설치 프로그램 스플래시·정식 판/오프라인판 배포·README·티저 사이트(핵심 기능 3개)·개인 브랜드 적용 상세 설계 — 2026-11-01 추천안 확정·구현(브랜드 키트 sanbonjini v2.0.0, 만든 이 표시 M1/H1, 10절 기록) — 구현 `v1.0.0` · 시그니처 스크린샷 `docs/screenshots/` |
  | `improve-1101-spec.md` | 2026-11-01 릴리스 후 개선 8건(진단 정보 여백, 패널 폭 자유 조절, 데일리 뷰 이름·날짜 띠·메모 크게 보기, 가져오기 미리보기 숫자 칸, 메모 글 링크 ↗, 업데이트·정보·오픈소스 라이선스, 새 판 안내 띠) 상세 설계·시안(`docs/mockups/1101/`) — 2026-11-01 추천안 승인·구현(11절 기록) — 구현 `v1.1.0` · 데일리 뷰 날짜 이동 다듬기(12절) `v1.1.1` |
  | `features-1102-spec.md` | 신규 기능 6건(F1 검색 · F2 휴일 설정 · F3 국내 공휴일 자동(앱 안 표, 통신 없음 추천) · F4 메모 보드 마크다운 내보내기 · F5 Cabinet 폴더 탐색기 · F6 빠른 이용 가이드 HTML·PDF) 항목별 상세 설계·시안(`docs/mockups/1102/`) — F1 구현 `v1.2.0` · F2~F6 구현 `v1.3.0`(F5 끌어 놓기 A안 회사 PC 확인 대기, F6 이용 가이드 `docs/guide/` → `site/guide/`) |
  | `improve-1102-spec.md` | 2026-11-02 개선(Cabinet 별도 창·전체/진행 중 업무 목록·줄 끌어 업무 연결·순서·크롬 주소 아이콘 놓기·탐색기 폴더 안으로·업무 이름 옆 🗄, 스플래시 `버전 X.Y.Z`) — 추천안 자동 승인·구현 `v1.4.0` · 시안 `docs/mockups/1102b/` |
  | `improve-1102v7-spec.md` | 2026-11-02 개선 v7(주간 뷰 열 폭·Cabinet 폴더 놓기 이유·바로 가기·줄 탐색기 단추·폴더 확인·경로 다시 지정·폴더 창 새로 고침·업무 목록 폭·메모 사각형 다중 선택·끌기 손잡이) — 추천안 자동 승인·구현 `v1.5.0` · 시안 `docs/mockups/1102v7/` |
  | `macos-spec.md` | macOS 판 배포 상세 설계(하나의 원본·같은 판 — 윈도우 전용 코드 점검 W1~W15, 앱 메뉴·안전 종료, 문구 맥 표기 변환, 동기화 폴더 감지, Cabinet 끌어 놓기, DMG 업데이트 교체, 워크플로 재구성, 위험 R1~R14, 실행 계획 M0~M4) — 2026-11-02 추천안 승인(D1~D8, 실기 = MacBook Pro M4 Pro)·구현 `v1.6.0`(9절 기록) |
  | `improve-1103v8-spec.md` | 2026-11-03 개선 v8(항목 시작 시각 15분 단위·구조 v10, 다른 날로 옮기기 — 세부 항목 함께·★ 패널 반영, 첫 실행 업무 이름이 버려지던 버그·맥 한글 Enter, 메모 상자 ⋯ 단추 잘 보이게) — 승인(D1 = 시작 시각, 사용자 수정)·구현 `v1.7.0`(9절 기록) · 시안 `docs/mockups/1103v8/` |
  | `improve-1103v9-spec.md` | 2026-11-03 개선 v9(항목 도구 겹침 정리 — 시안 A ⋯ 모으기 · B 떠 있는 막대 · C 왼쪽 손잡이 메뉴, 시작 시각 00~23시, 중요 업무 "오늘" 묶음 배경) — 2026-11-03 승인(D1 = C안 + 손잡이 더 크게, 나머지 추천안)·구현 `v1.7.1`(9절 기록) · 시안 `docs/mockups/1103v9/` |
  | `multi-board-spec.md` | 구조 개편 1 — 멀티 보드 = **워크스페이스**(회사·개인… 공간마다 폴더·일지 파일 1개, 마이그레이션 없음) 상세 설계 — 2026-11-03 승인(D1~D11 추천안 + 모노그램 아이콘 28개·색 따로), 레일 맨 위 공간 단추·`Ctrl+Alt+1~9/0`·4단계 만들기·설정 › 워크스페이스·업데이트 전 백업 전체·Rust 내보내기 검사 전체 폴더 — 구현 `v1.8.0`(13절, 검증용 rc.2 실기 확인 완료 — rc.1 목록 사라짐 버그 수정 기록 포함) · **14절 1.8.0 결함 = 전환 때 메모 이미지 유실 원인·무결성 점검·수정 `v1.8.1`**(일지를 바꿀 때 화면 저장소 `detachAll`, 메모 저장·정리는 문서를 읽어 온 일지에만) · 시안 `docs/mockups/1103mb/` · 다음 = Universe 설계 |
  | `universe-spec.md` | 구조 개편 2 — **Universe**(지식 네트워크·세컨드 브레인) 상세 설계 — 사용자 첨부 "세컨드 브레인" 명세(`universe/second-brain-ref/`, 원본 보관) 분석(받을 것·고칠 것·미룰 것) + 원 요청(옵시디언형 전체 연결망·년월일 시간 브라우징·태그·멀티 보드) 보강, 명칭 후보(Universe·지식 지도 등, 지식 카드·근거 묶음), 지도 시안 A 은하 · B 시간의 강 · C 초점 탐색(추천 C 기본 + A 전환 + 시간 막대), 노드·관계 출처, 직접 연결·지식 카드·근거 묶음, 여러 공간 읽기 전용, 단계 UV1~UV4 — 2026-11-03 승인(D1~D10 추천안) · 작업 브랜치 **`universe-model`** · UV1 지도 보기 구현(13절, 검증용 `1.9.0-rc.1` → v1.8.1 전환 무결성 수정을 합친 `1.9.0-rc.2`) · UV2 직접 연결 구현(14절, 구조 v11 `universe_relation`, 검증용 `1.10.0-rc.1`) · 시안 `docs/mockups/1103un/` |
  | `guide/` | **빠른 이용 가이드 원본**(장면별 `NN-이름.md` 14 + 부록 · `map.md` 기능 ↔ 장면 대응표·기준 판·갱신일) → `node scripts/guide/guide.mjs build`·`pdf`·`shots`가 소개 사이트 `site/guide/`(HTML·PDF·스크린샷) 생성, CI `guide.mjs check` |
  | `brand-spec.md` | 앱 아이콘(노트·책갈피, 작은 판)·워드마크(그로테스크 + 손글씨 Journey, SVG 도형) — 생성 도구 `scripts/brand/` |
  | `wireframes/` | 주간 보드·첫 실행/연간 보기·인사이트·스플래시 와이어프레임(svg)·스플래시 창 화면(png) |
  | `samples/*.xlsx` | 엑셀 내보내기 양식 샘플 · 기존 일지 가져오기 양식 샘플(가상 데이터) |
  | `project-plan.md` | 마일스톤 I-M0~M5·관문 G1/G2 |
  | `i-m1-plan.md` · `i-m2-plan.md` · `i-m3-plan.md` | 마일스톤별 세션 계획(I-M1 완료, I-M2 주간 요약·엑셀, I-M3 기존 일지 가져오기 + 시각화) |
  | `m1-check.md` · `g2-log.md` | 회사 PC 확인표(I-M1 v0.1.0 · I-M2 v0.2.0 7-2절 · 메모 7-3 · 가져오기 7-4 · 개선 U1 7-5 · U2 7-6 · U3 7-7 · U4 7-8 · V1 7-9 · V2 7-10 · V3 7-11 · M3-S1 7-12 · M3-S2 7-13 · 관계선 7-14 · 다중 연결 7-15 · 개선 v3 W1 7-16 · 스냅샷 7-17 · 완료 뱃지 7-18 · 새 판 설치 7-19 · 설정·테마 7-20 · 가져오기 다듬기 7-21 · 시그니처 테마 7-22 · 최적화·복원 7-23 · 정식 릴리스 준비 7-24 · 릴리스 후 개선 7-25 · 검색 7-26 · 휴일 7-27 · 마크다운 7-28 · Cabinet 7-29 · Cabinet 다듬기 7-30 · v7 개선 7-31 · macOS 첫 판 7-32 · v8 개선 7-33 · v9 개선 7-34 · 워크스페이스 7-35 · 전환 무결성 7-36 · Universe UV1 7-37 · UV2 직접 연결 7-38) · ◆G2 실사용 마찰 기록 양식 |
- **스펙과 다르게 구현해야 하면** 먼저 사용자에게 묻고, 확정되면 같은 작업 안에서 `docs/` 스펙도 함께 갱신한다(스펙이 정본).

## 2. 기술 스택
| 영역 | 선택 |
|---|---|
| 껍데기 | **Tauri v2**, 윈도우 = NSIS **per-user**(`bundle.windows.nsis.installMode = "currentUser"`), WebView2 `embedBootstrapper`(예비: `offlineInstaller` 수동 빌드) · 맥 = 유니버설 DMG(`tauri.macos.conf.json`, 애드혹 서명, macOS 13+, `Info.plist` 한국어·폴더 접근 이유) |
| 화면 | React 18 + Vite + TypeScript(strict) |
| 상태 | Zustand(화면 상태) — 영속 데이터는 항상 저장소 경유 |
| 스타일 | CSS Modules + `src/shared/tokens.css` 디자인 토큰(라이트/다크) |
| 저장 | SQLite. 실앱 `tauri-plugin-sql` / 개발·테스트 **sql.js(SQLite WASM)** — **같은 스키마·마이그레이션 SQL** |
| 날짜 | date-fns(ISO 주차 함수) — 주차 계산은 `src/domain/week.ts` 한 곳 |
| 엑셀 | ExcelJS |
| 차트 | 직접 SVG + d3-scale/d3-array |
| Tauri 플러그인 | sql · dialog(폴더 선택·저장) · fs(저장 폴더 범위만) · clipboard-manager · single-instance · opener(폴더 열기) · window-state |
| 테스트 | Vitest(+Testing Library), Playwright(브라우저 모드 E2E·스크린샷 — Chromium 기준 + WebKit 보험) |
| 품질 | ESLint + Prettier, `tsc --noEmit` |
| CI | GitHub Actions: `ci.yml`(ubuntu: lint·typecheck·test·e2e + macos: Rust `cargo test`) / `build-desktop.yml`(windows-latest NSIS · macos-latest 유니버설 DMG 나란히 → main은 **둘 다 성공해야** `v<버전>` 릴리스 한 번에 생성·갱신, `SHA256SUMS.txt` 합침 — 0.x는 사전 릴리스, 1.0.0 이상 정식 판은 정식 릴리스, 윈도우 오프라인 설치판은 요청할 때만 수동 실행) |

## 3. 디렉토리 구조
```
src/
  domain/     week.ts · categories.ts(활성 계산) · nudge.ts(무기록 판정) · aggregate.ts(자동 집계) · insights.ts
              → 순수 함수만. UI·저장소·플랫폼 import 금지
  data/       driver.ts(SqlDriver) · drivers/tauriSql.ts · drivers/sqlJs.ts · repository.ts · migrations/0001_init.sql …
  export/     excel.ts · filename.ts · importTemplate.ts(가져오기 양식)
  import/     readTable.ts(가져올 엑셀·CSV·붙여넣은 글 읽기 — 읽기만)
  platform/   index.ts(인터페이스) · tauri.ts · browser.ts · fakeFs.ts(브라우저 모드 가짜 폴더)   ← 폴더 선택·설정·백업 파일·OneDrive 감지
  ui/         board/ · summary/ · insights/ · settings/ · first-run/ · common/
  shared/     strings.ts(UI 문자열 SSOT) · tokens.css · palette.ts(c1~c8)
src-tauri/    얇은 껍데기: 플러그인 등록·설정·CSP + 최소 명령(db_batch.rs 트랜잭션, files.rs 파일·설정). 업무 로직 금지
tests/        unit/ · e2e/
fixtures/     sample-*.json — 가상 업무 기록만
```

## 4. 이 프로젝트 고유 규칙

### 4-1. 외부 통신 0 (제품의 존재 이유)
- 앱 코드에서 외부 호스트로 가는 `fetch`·XHR·WebSocket·이미지/폰트 CDN 로드를 **넣지 않는다**. 본문 글꼴은 **Pretendard Variable**(SIL OFL 1.1) — npm `pretendard`(버전 고정)의 공식 woff2를 **수정 없이** 번들한다(`src/shared/fonts.css`, 라이선스 `public/licenses/`). OFL 예약 글꼴 이름 조항 때문에 글자 잘라내기 등 파일 수정 금지. 기본 글자 크기 14px(`--fs-md`). **시그니처 테마만** 고운돋움 Regular(SIL OFL 1.1, `src/shared/fonts/GowunDodum-Regular.woff2` 한글 전체 · 라이선스 `public/licenses/GowunDodum-OFL-1.1.txt`, 굵기 400 하나 → `--fw-bold: 400` + `font-synthesis: none`) — 라이트·다크는 Pretendard(design-renewal-v1 3절 A안, 2026-10-28 사용자 확정).
- Tauri CSP: `default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' data:; style-src 'self' 'unsafe-inline'`. 외부 도메인을 CSP에 추가하는 변경은 **사용자 승인 필수**.
- 자동 업데이트 플러그인(tauri updater)·텔레메트리·오류 리포팅 SDK·분석 도구 금지.
- **새 판 확인·설치 예외(v0.2.19, 2026-10-27 사용자 승인, improve-1027v4-spec 1절 B안)**: 인터넷에 나가는 곳은 Rust `src-tauri/src/update.rs` **하나** — GitHub Releases(이 저장소)의 판 목록·설치 파일·`SHA256SUMS.txt`만, **앱을 켤 때 1번 + 설정 [업데이트 확인]** 때만. 받은 설치 파일은 SHA256 확인 → 일지 자동 백업(`_pre-update`) → 실행(맥은 DMG를 열어 앱 번들 교체 — 4-3 앱 번들 예외, 1.6.0). 웹 화면 CSP(`connect-src`)는 그대로, 기록·메모 등 사용자 데이터는 보내지 않는다. 주소·시점을 넓히려면 사용자 승인.
- **링크 열기(v0.2.8, 2026-10-26 사용자 확정, improve-1026-spec 9·13절)**: 기록·메모 속 http/https 주소는 `Ctrl+클릭`·↗로 **OS 기본 브라우저에 넘길 뿐** 앱은 접속하지 않는다 — `Platform.openUrl` → Rust `open_url`(files.rs, http/https만 재검사 + cargo test). 링크 카드는 사용자가 쓴 제목·메모만(사이트 미리보기 B안은 하지 않음). 이 규칙을 넓히려면 사용자 승인.
- 새 의존성 추가 시 런타임 네트워크 호출 여부를 확인하고 PR/커밋 설명에 적는다.
- **홍보 문구(2026-11-02 사용자 지시)**: README·소개 사이트·공유 미리보기 그림·릴리스 소개 등에서 기능·특징을 강조할 때 "외부 통신 0"을 **내세우지 않는다**(구현 규칙은 그대로 지킨다). 개인정보 안내에서 사실을 짧게 적는 것은 괜찮다.
- AI API 모드(③)는 M4 이후 별도 승인 단계에서만 다룬다(그 전까지 코드 경로 없음). 클립보드 다리는 네트워크를 쓰지 않는다.

### 4-2. 실제 업무 기록 금지
- 저장소·테스트·스크린샷·이슈·커밋 메시지에 **실제 업무 내용을 넣지 않는다**. 테스트·시연은 `fixtures/`의 가상 샘플만.
- `.gitignore`에 `*.db`, `*.db-journal`, `backups/`, `exports/`, `*.xlsx`(`fixtures/`·`docs/samples/`는 예외로 명시) 포함.

### 4-3. 데이터 파일 안전
- 영속 데이터 접근은 **`JournalRepository` → `SqlDriver`** 경로만. UI·domain에서 SQL 직접 실행 금지.
- 사용자 폴더의 파일을 지우는 코드는 **`src/data/backup.ts`의 가드 함수 1곳뿐**이며, data-spec 7-2절의 일일·월간 패턴과 앱이 만든 임시 사본(`*.db.tmp`)만 삭제한다. 실앱에서는 Rust `fs_remove_backup`·`fs_rename_backup`(src-tauri/src/files.rs)이 같은 패턴을 **한 번 더** 검사한다 — 두 곳의 규칙을 함께 바꾸고, 패턴 외 파일 보존 테스트(TS 단위·Rust `cargo test`)를 반드시 통과.
- 사용자 폴더에 쓰는 동작은 `Platform`(src/platform/) 인터페이스로만 한다. 덮어쓰기는 백업 사본 이름 바꾸기와 설정 파일 쓰기뿐이고, 일지 파일·다른 파일은 덮어쓰지 않는다(옮기기는 대상에 일지가 있으면 실패).
- **내보내기 파일 예외(2026-10-24 사용자 확정, i-m2-plan 6절 #5)**: 엑셀(`.xlsx`)은 **사용자가 저장 대화상자에서 고른 경로**에만 쓰고, 같은 이름이 있으면 윈도우 대화상자의 덮어쓰기 확인을 따른다. 확장자 `.xlsx` 외, 저장 폴더의 일지 파일, `backups\` 안은 거부 — Rust 쓰기 명령에서도 한 번 더 검사한다.
  - **주간 메모 이미지 저장(2026-10-25 사용자 확정, weekly-note-spec 11절 #3)**: 메모 이미지 상자의 [이미지로 저장…]도 같은 규칙으로 `.png`·`.webp`를 허용한다(저장 대화상자에서 고른 경로만, 일지 파일·`backups\` 거부, Rust 재검사). 메모 이미지 자체는 일지 파일 안(`note_asset`)에 저장하고 사용자 폴더에 따로 두지 않는다. 구현: `Platform.writeExport`(src/platform) + Rust `export_write`의 `EXPORT_EXTS`(v0.2.2).
  - **메모 보드 스냅샷(2026-10-27 사용자 확정, improve-1027v3-spec 1절)**: [PNG 그림으로 저장…]도 같은 길(`.png`·`.webp`, 새 Rust 명령 없음). 그림은 `src/export/noteSnapshot.ts`가 메모 문서로 직접 그린다(화면 캡처·외부 글꼴 없음). [그림으로 복사]는 `navigator.clipboard.write`(네트워크 없음)(v0.2.17).
  - **메모 보드 마크다운(2026-11-01 사용자 승인, features-1102-spec F4)**: [마크다운으로 내보내기…]는 저장 대화상자에서 고른 경로에 `.md` 하나 + 같은 이름 `<문서 이름>_images` 폴더(없으면 한 단계만 만듦) 안 원본 이미지(`.png`·`.webp`·`.jpg`·`.jpeg`·`.gif` — 이 폴더 안에서만)를 쓴다. 일지 파일·`backups\` 거부, Rust `export_write`의 `EXPORT_EXTS`·`MD_IMAGE_EXTS` 재검사 + `cargo test`. 변환은 `src/export/noteMarkdown.ts`(순수 함수·골든 테스트).
- **Cabinet 폴더 읽기·열기(2026-11-01 사용자 승인, features-1102-spec F5)**: 사용자가 등록한 작업 폴더(일지 `cabinet_item`)와 그 하위만 **목록 읽기(이름·종류·크기·수정 시각)·OS 기본 앱으로 열기·탐색기에서 보기**. 파일 내용을 읽지 않고(끌어 놓은 `.lnk` 바로 가기는 대상 경로만 읽음 — `cabinet_resolve_shortcut`), **지우기·이름 바꾸기·옮기기·복사 없음**. Rust `src-tauri/src/cabinet.rs`가 메인 창이 알려 준 등록 폴더 목록으로 매번 재검사(상대 경로·`..` 거부 → 정규화 후 접두어 비교, `cargo test`). 폴더 창·Cabinet 창은 별도 OS 창(`folder-*`·`cabinet`, `capabilities/folder.json`·`cabinet.json` — DB·네트워크 권한 없음, Cabinet 창의 등록·고치기는 메인 창 저장소에 허용 목록 메서드로만 부탁). 끌어 놓은 폴더 경로는 메인 창·Cabinet 창 WebView2 `postMessageWithAdditionalObjects` 다리(A안, 창마다 한 번)로만 받는다. 링크 항목은 링크 열기 규칙(4-1) 그대로 — 제목은 끌어 놓을 때 브라우저가 준 것만, 앱이 사이트에 접속해 읽지 않음. 범위를 넓히려면 사용자 승인.
- **맥 앱 번들 교체(v1.6.0, 2026-11-02 사용자 승인, macos-spec 3-5 D7)**: 맥 업데이트는 받은 DMG를 읽기 전용으로 열어 지금 실행 중인 `…/X.app`을 바꾼다 — 옆에 `X.app.new`로 복사 → 지금 것을 `X.app.old`로 → `.new`를 원래 이름으로 → `.old` 지움. 지울 수 있는 것은 **지금 번들 바로 옆의 `X.app.new`·`X.app.old` 둘뿐**(Rust `update.rs` `removable_leftover` + `cargo test`), 앱 이동 보호(임시 위치)·디스크 이미지 안 실행은 거부, 쓸 권한이 없으면 DMG를 Finder로 열어 주고 사용자가 직접 바꾼다. 사용자 폴더·일지는 건드리지 않는다.
- **Cabinet 맥 끌어 놓기(v1.6.0, macos-spec 3-4)**: 맥(WKWebView)은 놓은 File에 경로가 없어, 놓은 직후 끌기 붙임판(`NSPasteboardNameDrag`)의 **파일 경로만** 읽는다(`cabinet_drag_paths` — 놓은 이름과 같은 것만, Finder 가상본은 대상 경로로). 파일 내용은 읽지 않는다. Tauri 기본 끌어 놓기(`dragDropEnabled`)는 맥에서 화면 안 끌기까지 막아 쓰지 않는다.
- **기존 일지 가져오기(v0.2.4, i-m3-plan 3-9)**: 가져올 파일·붙여넣은 글은 **읽기만**(웹 표준 파일 선택, 새 Rust 명령 없음). 쓰기 직전 `_pre-import` 자동 백업 → `JournalRepository.applyImport` 한 batch. 덮어쓰기는 일지 안의 행을 바꾸는 것(사용자 폴더 파일 삭제 아님)이며 되돌리기 자료(`import_batch.undo_json`)를 함께 남긴다.
- **백업에서 복원(v0.4.0, 2026-11-01 사용자 승인, optimize-1031-plan O5)**: 일지 파일을 바꾸는 유일한 예외. 일지가 닫힌 상태에서 ① 지금 일지를 `backups\work-journey_<시각>_before-restore.db`로 **옮겨 보존** ② 고른 백업을 일지 이름으로 **새 파일 복사**(②가 실패하면 ① 되돌림). 지우는 파일은 없다. TS `restoreFromBackup`(session.ts, 이름 규칙 `backup.ts` `isRestorableName`·`isBeforeRestoreName`) + Rust `restore_journal`(files.rs, 이름·경로 재검사 + `cargo test`) — 두 곳의 규칙을 함께 바꾼다.
- **보조 백업 위치(v0.4.0, optimize-1031-plan B6)**: 이 PC 설정 `config.json` `backupMirror`(기본 없음) 폴더에 일일 사본 쓰기·롤링(최근 3개) — 지우는 것은 그 폴더의 일일 패턴 파일뿐(같은 `removeGuarded`·Rust 가드). 저장 폴더·`backups\`는 고를 수 없다.
- **워크스페이스(v1.8.0, 2026-11-03 사용자 승인, multi-board-spec)**: 공간마다 폴더·일지 파일 1개(데이터 = 공간마다 파일 1개). 목록은 이 PC `config.json` `workspaces[]`(정본 이름·색·아이콘은 각 일지 `settings.workspace`), 지금 연 공간 = `dataDir`. 새 공간 = 고른 폴더를 만들고(없으면 한 단계) 새 일지 생성. [목록에서 빼기]는 **설정 목록에서만** — 폴더·일지 파일은 지우지 않는다. 다른 공간 일지는 업데이트 전 백업 때만 잠깐 열어 그 폴더 `backups`에 `_pre-update` 사본을 쓴다. Rust `export_write`는 등록된 모든 공간의 `backups`를 거부한다(`cargo test`).
- 여러 문장을 묶는 쓰기는 **`SqlDriver.batch`로만** 한다. `BEGIN`/`COMMIT`을 `execute`로 따로 보내지 않는다(실앱 연결 풀 문제, data-spec 8-1).
- 스키마 변경 = 새 마이그레이션 파일(전진 전용) + **마이그레이션 직전 자동 백업** + fixture DB 왕복 테스트. 기존 마이그레이션 파일 수정 금지.
- `PRAGMA journal_mode=DELETE` 유지(WAL 금지 — 데이터 = 파일 1개 원칙).

### 4-4. 도메인 규칙의 단일 출처
- 주차: `domain/week.ts`만. SQL `strftime('%W')` 금지.
- 카테고리 활성·무기록 판정·자동 집계 포맷은 각 domain 모듈만 — 엑셀·시각화·패널이 같은 함수를 재사용.
- 자동 집계는 output-spec 2-2절 샘플과 **문자 단위 골든 테스트**로 고정.

### 4-5. 얇은 Tauri 껍데기
- 기능의 80~90%는 **브라우저 모드(`npm run dev`, sql.js + 샘플 시드)** 에서 개발·테스트한다(클라우드 리눅스 세션 전제).
- 플랫폼 차이는 `src/platform/`의 인터페이스 뒤로만. Rust 코드는 플러그인 등록·설정 위주, 커맨드가 필요하면 최소한으로.
- **하나의 원본, 두 플랫폼(macos-spec, 2026-11-02 사용자 지시)**: 기능은 한 번 구현해 윈도우·맥이 같은 판·같은 기능으로 나간다(플랫폼별 브랜치·판 번호 없음). 윈도우·맥 차이는 **네 곳에만** 둔다 — ① `src/platform/`(TS) ② `src-tauri/src/`의 `#[cfg(windows)]`·`#[cfg(target_os = "macos")]` ③ `tauri.macos.conf.json`·`Info.plist` ④ 문구 표기 `src/shared/platformText.ts`(문구는 `strings.ts` 한 벌 = 윈도우 표기, 맥에서 `⌘`·`⌥`·Finder로 자동 변환 — 단위 테스트가 변환 뒤 윈도우 표기가 남지 않는지 본다). 화면 코드에서 OS로 동작을 가르지 않는다(예외: 맥 ⌥ 단축키 조합 판정 `ui/board/helpers.ts` 한 곳). 브라우저 모드 `?os=mac` = 맥 표기.
- **실기 확인 항목**(마일스톤마다): 윈도우 = 회사 PC(설치·실행, 폴더 선택 대화상자, OneDrive 경로 감지, 파일 저장·백업, WebView2 화면, 엑셀 열기) · 맥 = 사용자 MacBook Pro M4 Pro(설치·첫 실행 안내, 한글 입력·⌥ 단축키, Cabinet 끌어 놓기, 메뉴·⌘Q 종료, DMG 업데이트) — `m1-check.md` 7-32.

### 4-6. 입력 UX 우선
- 매일 기록이 **2분 이내**여야 한다(◆G2). 키보드만으로 오늘 칸 기록이 끝나야 하며, 입력 지연·포커스 이탈·저장 실패는 최우선 버그.
- 단축키 표(`docs/overview.md` 10-3절)를 바꾸면 화면 도움말과 그 표를 함께 갱신.

### 4-7. 일지 전환 무결성 (재발 방지, v1.8.1 — multi-board-spec 14절)
> 1.8.0 결함: 공간을 바꾼 직후 메모 정리가 "이전 공간의 문서"로 "새 공간의 이미지"를 지웠다. 화면 저장소가 이전 일지 상태를 든 채 새 일지에 쓰면 데이터가 사라진다. 아래는 워크스페이스·Universe 등 **일지가 둘 이상 오가는 모든 기능**에 적용한다.
- **일지를 바꾸는 길은 한 순서만**: `flushPending` → `finishNote` → (종료 백업) → `detachAll()` → 이전 드라이버 닫기 → `activate`. 공간 전환·저장 위치 바꾸기·옮기기·복원·파손 화면·Universe [그 공간에서 열기] 모두 `appController`의 이 길을 쓴다 — 새 길을 만들지 말고 `switchWorkspace`·`closeCurrent`를 재사용한다.
- **모듈 상태를 두는 화면 저장소는 `detachX()` 필수**: 일지에서 읽은 데이터·예약 저장 타이머·실행 취소 기록·캐시·구독을 가진 저장소(`boardStore`·`summaryStore`·`noteStore`·`insightsStore`·`universeStore`·새 저장소)는 그것을 모두 비우는 `detachX()`를 만들고 `appController.detachAll()`에 등록한다(appController를 가져다 쓰는 저장소는 `onDetach(detachX)`로 등록 — 가져오기 고리 없이). 끊긴 동안(`repo === null`)에는 예약 저장을 받지 않는다.
- **쓰기·지우기는 읽어 온 그 일지에만**: 데이터를 읽을 때 저장소를 함께 기억하고(`noteStore`의 `docRepo` 패턴), 저장·정리는 그 저장소로 한다. `await` 뒤에는 저장소가 그대로인지 확인하고 아니면 결과를 버린다. 지우는 동작(`pruneNoteAssets`처럼 "목록에 없는 것을 지움")은 **같은 일지에서 읽은 목록** 기준으로만 계산한다.
- **다른 공간 읽기는 읽기 전용 임시 저장소로만**: Universe 등은 다른 일지를 열어 읽고 바로 닫는다. 화면 저장소의 `repo`에 연결하지 않고, 그 일지에 쓰지 않는다.
- **시험**: 일지 데이터를 다루는 기능을 더하거나 바꾸면 `tests/e2e/workspace-integrity.spec.ts`에 "넣기 → 공간 오가기(3번 이상) → 그대로" 시나리오를 더한다. 화면만이 아니라 저장소 개수(`__wjbApp`)도 확인한다. 확인표에도 전환 무결성 항목을 둔다(`m1-check.md` 7-36 형식).

## 5. 명령
```bash
npm run dev          # 브라우저 모드(sql.js, 가상 샘플 시드) — 클라우드 세션 기본
npm run tauri dev    # 실앱 모드(윈도우·맥 로컬 전용)
npm test             # Vitest
npm run e2e          # Playwright(브라우저 모드) — Chromium + WebKit
npm run e2e:chromium # WebKit을 받을 수 없는 클라우드 세션용(두 엔진은 CI에서)
npm run perf:mem     # 주 전환 메모리·조회 수 측정(가상 1년치 일지 ?sample=year[-img], optimize-1031-plan O1) — CI는 main만
npm run lint && npm run typecheck
```

## 6. 버전·Git
- 버전 정본 = `package.json` `version`, **semver**(`1.0.0`) — Tauri·NSIS가 semver를 요구하므로 공통 규칙의 소수 4자리 관례 대신 semver를 쓴다. `tauri.conf.json`은 `"version": "../package.json"`으로 참조.
- 판올림은 `main` 병합 시점에 사용자에게 묻는다(현재 버전 + 추천 버전 제시). 확정 시 같은 커밋에서 README **Version History** 기록 + **릴리스 노트 `docs/release-notes/v<버전>.md`**(공통 규칙 3-6, 틀·검사는 improve-1027v3-spec 5절 — CI `release-notes.mjs check`가 누락을 막고, main 빌드가 이 파일로 릴리스 본문을 만든다).
- **이용 가이드 동반 갱신(features-1102-spec F6)**: 화면·동작이 바뀌는 작업은 같은 작업 안에서 `docs/guide/map.md` 대응표로 해당 장면 글을 고치고, 화면이 바뀌면 `npm run dev`를 띄운 채 `node scripts/guide/guide.mjs shots` → `build` → `pdf`로 `site/guide/`를 다시 만들어 함께 커밋한다(기준 판·갱신일은 `map.md`). 판올림 릴리스 노트에는 **`## 가이드`** 절(바뀐 장면 또는 "변경 없음") — 1.3.0부터 `release-notes.mjs check`가 막고, CI `guide.mjs check`가 대응표·그림·HTML·PDF가 원본과 맞는지 본다.
- Git: **기본 정책(커밋·푸시·머지 전 사용자 확인)** — 코드·설정·워크플로 변경에 적용.
- **예외(2026-10-23 사용자 지시)**: `docs/`·`README.md`·`CLAUDE.md` 등 **문서만 바뀌는 변경**은 확인 없이 `main`에 바로 커밋·푸시한다. 코드가 함께 바뀌면 기본 정책을 따른다.
- 릴리스 = `main` 빌드가 `package.json` 버전으로 `v<버전>` 릴리스·태그를 **워크플로가 직접** 만든다(세션에서 태그 푸시가 막혀 있음). "운영 반영" = 회사 PC에 설치 파일 설치.
- **오프라인 설치판(`webview=offline` 수동 실행)은 사용자가 따로 요구할 때만 만든다**(2026-10-23 사용자 지시, 2026-11-01 재확인 — 정식 판 자동 포함 예외는 폐지). main에서 수동 실행하면 그 판 릴리스에 오프라인판을 더한다. 기본 설치 파일 빌드(푸시 시 자동)는 그대로다.
  - 정식 판(`1.0.0` 이상, 꼬리표 없음)의 main 빌드는 릴리스를 사전 릴리스가 아닌 **정식(Latest)** 으로 표시한다(`scripts/release-notes.mjs formal`이 판정, release-phase2-spec 4절). 0.x·-rc 판은 사전 릴리스.

## 7. 마일스톤 (project-plan.md)
I-M0 설치 검증(◆G1) → I-M1 핵심 기록(◆G2 2주 실사용) → I-M2 집계·엑셀 → I-M3 시각화 → I-M4 AI 클립보드 다리 → I-M5 안정화·v1.0.0
