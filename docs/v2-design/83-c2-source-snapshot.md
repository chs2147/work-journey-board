# 83. C-2 — 원본 일지 읽기 전용 사본 (Preview)

2026-11-15 · `v2-design` · [81문서](81-c-stage-copy-design.md) C-2 · 앞 단계 [82](82-c1a-paged-upload.md)(C-1 서버 계약 v2, 실서버 검증 완료)

## 동작

Preview(Rust `src-tauri/src/source_copy.rs`, Preview 빌드에만)가 사용자가 고른 로컬 일지 폴더의 `work-journey.db`를 **읽기만** 해서 Preview 자기 폴더 `…/WorkJourneyBoardConnectedPreview/development/<ref>/snapshots/<ID>/`에 사본을 만든다. 이관 엔진(C-3)은 이 사본만 읽는다.

| 규칙 | 내용 |
|---|---|
| 원본 불변 | 복사는 읽기만. 임시 파일(`.copying`)도 Preview 폴더 안. 원본 폴더에 파일·폴더를 만들지 않는다(시험: 파일 목록·수정 시각 그대로) |
| 쓰는 중 거절 | `work-journey.db-journal`·`-wal`이 있으면 `SOURCE_IN_USE` — 정식판·DEV에서 일지를 닫고 다시 |
| 복사 중 변경 감지 | 복사 전후 원본 크기·수정 시각·SHA-256, 사본 크기·해시가 모두 같아야 함 → 다르면 사본을 지우고 `SOURCE_CHANGED` |
| 겹침 거절 | 원본 폴더와 Preview 폴더가 서로 안에 있으면 `SOURCE_OVERLAPS_PREVIEW`(원본 안에 아무것도 만들지 않음) |
| 크기 | 512MB 상한(예전 이미지 base64가 든 일지 여유) |
| 지우기 | snapshots 아래 우리가 만든 ID 폴더만(`../` 등 거절) |
| 전달 | 사본 바이트는 원시 바이트(`tauri::ipc::Response`)로 화면에 — JSON 배열로 바꾸지 않음 |
| 권한 | Preview 메인 창에 `dialog:allow-open`(폴더 고르기)만 추가 — 저장 대화상자·파일 쓰기·SQLite 권한은 여전히 없음, Classic 권한의 부분 집합 유지 |

화면 연결: `src/platform` `PreviewSource`(`pickFolder`·`snapshot`·`read`·`remove`) → `tauriPreviewSource.ts`. 브라우저 모드 대체는 C-3·C-4에서(가상 일지).

## 시험

Rust Preview 빌드 42(새 2: 읽기만·원본 그대로·같은 ID 거절·지우기 / 쓰는 중·없음·일지 아님·겹침·상대 경로·잘못된 ID 거절) · Classic 32 · DEV 32 · Vitest(`appProfile`: Preview 명령 목록·권한) 통과.

## 다음

C-3 이관 엔진: `poc/v2-migration`의 DB18/19/20 매핑·manifest를 앱(Preview 전용)으로 옮겨 사본을 sql.js로 읽고 → 페이지·이미지 목록 → C-1 HTTP 경로로 업로드, 재개·취소 저널.
