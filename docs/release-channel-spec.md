# 정식판·DEV 검증판 운영 정책

2026-11-14 사용자 확정 · `v2-design`부터 적용(작업 브랜치에서 구현, main 반영은 판올림 때 확인) · 관련: CLAUDE.md 4-8, V2 [78](v2-design/78-preview-native-bootstrap.md)·[80](v2-design/80-release-channel-dev.md)

## 1. 왜

비공식 판(RC·작업 브랜치 빌드·Preview)을 시험할 때마다 정식판과 같은 앱 ID·설정 폴더를 써서 **정식판 설치를 덮어쓰고 정식 업무일지를 그대로 열었다**. 새 구조(DB 버전)의 검증판이 정식 일지를 열면 구조가 올라가 정식판에서 못 여는 위험이 있다.

## 2. 채널

| 채널 | 언제 | 앱 ID · 이름 | 설정 폴더 | 업데이트 | 일지 |
|---|---|---|---|---|---|
| **정식판** | `main` 빌드(릴리스) | `com.chs2147.workjourneyboard` · Work Journey Board | `WorkJourneyBoard` | GitHub Releases(지금 그대로) | 지금 쓰는 정식 일지·설정 그대로 |
| **DEV 검증판** | `main` 밖 모든 빌드(작업 브랜치·RC) | `com.chs2147.workjourneyboard.dev` · Work Journey Board DEV · 실행 파일 `work-journey-board-dev` | `WorkJourneyBoardDev` | 꺼짐 | DEV 일지만(3절) |
| **Connected Preview** | `v2-design` 온라인 검증 | `…connected.preview` · Work Journey Board Connected Preview | `WorkJourneyBoardConnectedPreview` | 꺼짐 | 로컬 일지 없음(온라인 계정만) |

- 판정은 빌드 때 한 번: `build-desktop.yml` `plan` 단계 — `refs/heads/main`이면 정식판, 아니면 DEV(`--features dev-channel` + `src-tauri/tauri.dev.conf.json`). Preview는 `build-preview.yml`.
- 정식판 빌드는 이 정책 전과 **같은 앱 ID·설정 폴더·업데이트·명령 목록**이다(단위·Rust 시험이 고정). 정식판을 새로 설치하거나 업데이트해도 기존 정식 일지·설정을 그대로 쓴다.
- 비공식 판 설치 파일은 **릴리스·기존 업데이트 피드에 올리지 않는다**(Actions 산출물만, `WorkJourneyBoardDEV_<판>_setup.exe`·`_mac.dmg`).
- 앱 ID와 실행 파일 이름이 달라 **별도의 앱으로 설치·제거**된다(윈도우 설치 폴더·시작 메뉴·프로그램 제거 항목, 맥 응용 프로그램 폴더의 별도 앱). 윈도우 설치 프로그램이 실행 중인 정식판을 같은 이름으로 보고 닫으려 하지 않는다.
- 빌드 프로필과 설정 앱 ID가 맞지 않으면(예: DEV 빌드를 정식 설정으로) 창·설정 파일보다 먼저 멈춘다(`profile::check_identifier`).

## 3. 정식 일지 보호(DEV)

- DEV가 만들거나 복제한 일지 폴더에는 표시 파일 `.wjb-dev-journal`이 있다.
- **화면**: 모든 일지 열기가 지나는 `openJournalAt`이 연결·백업·마이그레이션보다 먼저 `platform.dev.prepareFolder`를 부른다 — DEV 표시 있음 = 통과 / 일지 없음 = 표시를 남기고 새 일지 / **정식 일지 = 거절**(“정식판 일지는 DEV에서 열 수 없습니다” 화면, 쓰기 0). 저장 위치 옮기기는 새 폴더에 표시를 먼저 남긴다.
- **Rust 이중 가드**(`src-tauri/src/dev_guard.rs`): DEV 빌드에서 일지 쓰기(`db_batch`)·백업 사본·이름 바꾸기·지우기·복원·폴더 만들기·내보내기는 대상 파일의 폴더 또는 한 단계 위가 **정식 일지 폴더(일지 있음 + 표시 없음)면 거절**(`OFFICIAL_JOURNAL_PROTECTED`). 정식판 빌드에서는 이 검사가 그냥 통과한다.
- 한계: 플러그인 SQL 단일 문장 쓰기는 화면 쪽 검사가 막는다(Rust 가드는 묶음 쓰기·파일 동작). 보조 백업 위치는 일지 없는 폴더만 쓸 수 있다.
- DEV는 정식판 `config.json`을 **읽지도 않는다**(설정 폴더가 다름). 앞으로 DEV·Preview에 환경변수가 필요하면 `WJB_DEV_*`·`WJB_PREVIEW_*`처럼 전용 이름만 읽는다(지금 앱은 OneDrive 경로 외 환경변수를 읽지 않음).

## 4. DEV 일지 선택(설치마다)

DEV를 처음 켜거나 **다른 판을 설치하면**(설정의 `devSetupVersion` ≠ 앱 판) 일지를 묻는다.

| 옵션 | 동작 |
|---|---|
| **빈 일지**(기본값) | 고른 DEV 폴더에 새 일지 |
| 가상 샘플 | 새 일지 + `fixtures/sample-showcase.json`(가상 자료) |
| 정식 일지 복제 | 고른 정식 일지 폴더의 일지를 **읽기만** 해서 DEV 폴더에 새 파일로 복사 → DEV 표시. 정식판이 쓰는 중(`work-journey.db-journal`)이면 거절. 원본 폴더에는 아무것도 만들지 않는다 |

- 기본 DEV 폴더 = 정식 기본 폴더 옆 `<…>/WorkJourney DEV`. 정식 일지가 있는 폴더·이미 DEV 일지가 있는 폴더는 새 일지 자리로 고를 수 없다.
- 지난 DEV 일지(DEV 표시 폴더)가 있으면 **[지난 DEV 일지 계속 쓰기]**도 보인다(새 판 시험 때 이전 시험 자료 유지용).

## 5. 표시

- 비공식 판(DEV·Preview)은 `<html data-channel="dev">`: 상단 타이틀 줄을 주황 계열 띠 + 위쪽 3px 선(직각, UI 강조 띠 규칙) + 오른쪽 **DEV** 배지. 라이트·다크·시그니처 각각 토큰(`--dev-accent`·`--dev-band`…, `tokens.css`).
- 창 제목·설치 이름 = Work Journey Board DEV. Preview 시작 화면 제목 옆에도 DEV 배지.
- 업데이트 확인은 하지 않는다(설정 화면: “DEV 판은 업데이트를 확인하지 않습니다”).
- **설치·실행 아이콘(2026-11-15 사용자 지시)**: 비공식 판(DEV·Preview, 앞으로 생길 비공식 판 포함)은 **정식판과 다른 설치 아이콘**을 쓴다 — 바탕을 DEV 주황(`--dev-accent` #c2410c)으로, 48px 이상은 아래에 흰 글자 **DEV** 띠(#7c2d12, 직각). 16~32px 작은 판은 주황 바탕만. 바탕화면·시작 메뉴·작업 표시줄·Dock·설치 프로그램 아이콘에서 정식판(파란 바탕)과 바로 구분된다.
  - 파일 = `src-tauri/icons-dev/`(정식판 `icons/`와 같은 구성), `tauri.dev.conf.json`·`tauri.preview.conf.json`의 `bundle.icon`·`bundle.windows.nsis.installerIcon`이 가리킨다. 정식판 설정은 `icons/`만.
  - 앱 안 그림(스플래시·화면 로고)은 그대로 둬도 된다(앱 안에서는 DEV 띠·배지로 구분).
  - 만들기: `node scripts/brand/render_icons.mjs <폴더> --variant dev` → `python3 scripts/brand/pack_icons.py <폴더> src-tauri/icons-dev`. 정식 아이콘을 바꾸면 DEV 판도 함께 다시 만든다.
  - 시험: `devChannel.test.ts`(구성 같음·내용 다름·정식판 설정에 없음) · `appProfile.test.ts`(Preview도 같은 아이콘).

## 6. 검증

- Rust: 정식판 빌드 32 · DEV 빌드 32 · Preview 빌드 40(정식 폴더·backups 쓰기 거절, 빈 폴더만 표시, 복제는 원본 읽기만·겹침/재복제/쓰는 중 거절, DEV 빌드 = DEV 앱 ID·업데이트 거절·정식 설정 거절)
- 단위: `devChannel.test.ts`(정식 일지 열기 거절 시 파일 목록·크기 그대로, 복제, 설정 왕복, `tauri.dev.conf.json`, Rust 쓰기 명령 가드 연결) · `appProfile.test.ts`(정식판 명령 목록 그대로, DEV = 정식판 + 3개)
- E2E: `dev-channel.spec.ts`(설치마다 선택·기본 빈 일지·정식 폴더 거절·샘플 → DEV 배지/띠·복제·정식판에는 없음)
- 실제 실행(Linux, Xvfb): DEV 디버그 빌드 → DEV 일지 선택 화면·배지·자료 폴더 `com.chs2147.workjourneyboard.dev` 분리
- 남은 실기(회사 PC·맥): 정식판과 DEV 동시 설치·실행, 설치·제거가 서로 영향 없음, 정식 일지 폴더를 골랐을 때 거절, 복제 후 정식 일지 수정 시각 그대로 — `m1-check.md`에 항목 추가 예정(main 반영 전)
