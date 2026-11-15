# 86. C-5 — 온라인 사본 실기 확인 (Windows·macOS)

2026-11-15 · `v2-design` · 앞 단계 [85 C-4](85-c4-copy-screen.md) · main 미반영

## 1. 설치 파일

`Build Connected Preview (verification)` run 8(`d7db3e0`, 비공식 판 아이콘 포함) 산출물 — 2026-11-29까지 보관, 릴리스·업데이트 피드에는 없음.

| OS | 산출물 |
|---|---|
| Windows | `connected-preview-windows-1.40.0-preview.d7db3e0` (NSIS, 현재 사용자) |
| macOS | `connected-preview-macos-1.40.0-preview.d7db3e0` (유니버설 DMG) |

같은 날 CI·DEV 설치 파일 빌드도 성공. 개발 서버 상태: 013 적용·gateway v9, 남은 작업·공간·그림 **0**(실기 전 확인).

## 2. 확인표

[m1-check 7-48](../m1-check.md) — DEV 일지(가상 샘플)로 1~6 → 정식 일지 7 → 큰 그림 8 → macOS 9.

확인할 핵심:
- **실제 정식 일지 구조**가 앱 기대 구조와 같은지(가장 큰 미확인 위험 — 지금까지는 sql.js·node가 만든 일지로만 시험). 다르면 `SCHEMA_UNSUPPORTED` 문구가 나오고 아무것도 올리지 않는다.
- 5~10MB 그림 실제 전송 시간(그림마다 gateway가 저장소에서 다시 읽어 확인).
- 앱 종료 후 이어하기(작업 ID 기반 같은 자료).
- 원본 폴더 불변(읽기 전용 사본은 Preview 자기 폴더에만).

## 3. 실기 뒤 서버 자료 확인·지우기

정식 일지를 올리면 그 내용이 **개발 서버**에 남는다. 확인·삭제는 이 저장소의 도구로(개수만 보고, 내용은 읽지 않음):

```bash
node poc/v2-gateway/edge/dev-copy-admin.mjs --report-development
```

```bash
node poc/v2-gateway/edge/dev-copy-admin.mjs --purge-owner-development <Preview 화면의 계정 ID 전체> --confirm
```

지우기는 그 계정의 이관 작업·기록·온라인 공간·그림(저장소 객체 포함)만 지운다. 로그인 계정·로컬 일지는 그대로. 세션에 요청하면 대신 실행한다.

## 4. 알려진 제약

- D-b(보류): 게시 직전 그림 재확인이 60초 안이어야 해 그림이 아주 많으면 게시가 멈출 수 있음 → [이어서 올리기]로 다시.
- D-c(보류): 작업 취소 때 그림 지우기 확인이 약 1분 걸릴 수 있음(저장소 캐시).
- 끊긴 작업은 서버에 4개까지(`MIGRATION_LIMIT`) — 넘으면 끝나지 않은 작업을 취소.

## 5. 실기 중 고친 것

- **2026-11-15 `SOURCE_NOT_JOURNAL`**(사용자 실기, run 8): DEV 일지 상위 폴더를 고르면 일지 파일(`work-journey.db`)이 바로 안에 없어 거절됐고, 이 코드의 한국어 문구가 빠져 코드가 그대로 보였다.
  - 고른 폴더에 일지가 없으면 **바로 아래 하위 폴더(한 단계)**, 그래도 없으면 **바로 위 폴더**(일지 폴더 안의 `backups`가 선택된 채 확인한 경우)에서 일지를 찾는다. 실패 문구에 실제로 받은 폴더 경로를 함께 보인다 — 하나면 그대로 진행, 여럿이면 "복제할 일지" 목록에서 고른다. Rust `source_candidates`(목록만 읽음, 더 깊은 폴더·심볼릭 링크 보지 않음, 최대 20개).
  - `source_copy.rs`의 모든 오류 코드에 한국어 문구(단위 시험이 빠짐을 막음).

