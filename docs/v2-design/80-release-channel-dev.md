# 80. 정식판·DEV 검증판 분리 — v2-design부터 적용

2026-11-14 KST · `v2-design` · 사용자 확정 · 정본 정책 = [`docs/release-channel-spec.md`](../release-channel-spec.md), CLAUDE.md 4-8

## 결정

- 비공식 판(Preview·RC·작업 브랜치 빌드)은 **정식판과 별도의 앱**(설치·제거·설정·일지 분리). 정식판은 공식 업데이트가 있기 전까지 평소처럼 쓴다.
- 로컬 비공식 판 이름 = **Work Journey Board DEV**(영문 DEV). 상단 타이틀 줄 오른쪽 **DEV 배지** + 개발판임을 알리는 주황 계열 타이틀 띠.
- DEV는 설치(판)마다 일지를 묻는다 — **빈 일지(기본)** · 가상 샘플 · 정식 일지 복제(옵션, 원본 읽기만).
- 정식판 배포(main) 때는 기존 정식 일지·설정이 그대로 적용된다.

## Preview와의 관계

Connected Preview(78·79문서)는 이미 별도 앱 ID·설정 폴더·실행 파일, 업데이트 꺼짐, 로컬 일지 없음으로 이 정책을 만족했다. 이번에 **DEV 배지·타이틀 띠**를 Preview 시작 화면에도 붙였다(`unofficial` 프로필). 공통 프로필 정본 `poc/v2-native/profiles.tsv`에 `local-dev` 줄을 더했다(Node isolation 3줄 검사로 갱신).

## 구현(요약)

| 영역 | 내용 |
|---|---|
| Rust | `dev-channel` 기능(Preview와 동시 불가 `compile_error`), `profile.rs` DEV 값·`is_dev`·`unofficial`, `dev_guard.rs`(표시 파일 `.wjb-dev-journal`, 정식 폴더 쓰기 거절, 빈 폴더 표시, 정식 일지 복제), `files.rs` 쓰기 명령 6개·`db_batch` 가드 연결, DEV 명령 목록 = 정식판 + 3개 |
| 설정 | `src-tauri/tauri.dev.conf.json`(앱 ID·이름·실행 파일·창 제목만) |
| 화면 | `activeProfile`·`DEV_PROFILE`, `platform.dev`(실앱 Rust / 브라우저 가짜 폴더), `openJournalAt` 첫 단계 검사, `DevSetup`·`DevOfficialRefused`, TopBar DEV 배지·`html[data-channel="dev"]` 띠, 창 제목 = 프로필 이름, 업데이트 확인 끔 |
| 빌드 | `build-desktop.yml` `plan.channel`(main = official, 그 밖 = dev) → DEV 빌드·산출물 이름 `WorkJourneyBoardDEV_*`·DMG 앱 ID 검사·Rust 시험 두 벌, `v2-design` 브랜치 추가 |

## 검증

Rust 정식판 32·DEV 32·Preview 40 · Vitest 64파일 577 · E2E `dev-channel` 5 포함 전체 Chromium 362/363(실패 1 = 기존 불안정 `note-relation.spec.ts:169`, 78문서 4절) · V2 회귀 · Linux 실제 DEV 실행(일지 선택·배지·자료 폴더 분리). [DEV 화면](evidence/dev-channel-linux-setup.png) · [DEV 보드(브라우저 모드)](evidence/dev-channel-board.png)

## 다음

- 실기(m1-check 7-47): 정식판과 DEV 동시 설치·실행, 정식 일지 보호, 복제 후 원본 그대로.
- main 반영 여부는 판올림 때 확인(정식판 동작은 그대로라 반영해도 정식 사용자 영향 없음).
