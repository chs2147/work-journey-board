# 82. C-1a — 기록 페이지 업로드·한도 확장 (로컬 완료, 개발 DB 미적용)

2026-11-15 · `v2-design` · [81문서](81-c-stage-copy-design.md) C-1의 앞부분 · 사용자 승인(81문서 4절 개발 서버 변경 3건 — 적용은 C-1b와 함께)

## 0. 한눈에

| 항목 | 결과 |
|---|---|
| 새 전진 SQL | `010-workspace-paged-upload.sql`(적용) · `012-…-verify.sql`(점검) · `011-…-rollback-empty.sql`(빈 상태 되돌리기). 생성기 `build-workspace-sql.py`, **001·004·007은 바이트 그대로** |
| 기록 한도 | 공간당 **2,048 → 20,000행**, 봉투 1MiB → 64MiB, 표별 4,096 → 20,000 |
| 나눠 보내기 | 머리(기록 없는 봉투) → **페이지(≤1,000행)** 최대 32개 → 받은 페이지 조회(끊긴 뒤 빠진 것만) → 서버가 조립해 **기존 시작 처리 그대로** → 페이지 삭제 |
| 성능 | 참조(FK) 검사를 기록마다 전체를 훑던 방식(행 수²)에서 **해시 조인 한 번**으로. 5,052행 검증 1.3초 · 19,952행(약 9MB) 4.5초 — 행 수에 비례 |
| 이미지 | 아직 8개·개당 64KiB(C-1b에서 Storage 직접 업로드로) |
| 시험 | 로컬 PostgreSQL 17.11 **115 통과**(기존 108 + 새 7) · 서버 RPC 19(새 3) · V2 회귀 341 |

## 1. 구조

- 기존 공개 명령 본문은 **바꾸지 않고** `wjb_migration.command_core`로 옮겼다(비공개, 실행 권한 없음). 공개 `wjb_v2_migration_command`는 새 4개 명령(`upload_begin`·`upload_page`·`upload_status`·`start_upload`)만 직접 처리하고 나머지는 그대로 넘긴다.
- 새 테이블 `wjb_migration.upload`·`upload_page`: RLS 켜짐, 모든 역할 직접 접근 없음. 소유자·기기·세션 확인은 기존과 같다(다른 계정은 업로드를 보지도·더하지도·시작하지도 못함).
- 같은 순번에 다른 내용 = `MIGRATION_PAGE_CHANGED`, 머리 바뀜 = `MIGRATION_IDEMPOTENCY_MISMATCH`, 빠진 페이지 = `MIGRATION_UPLOAD_INCOMPLETE`. 시작 뒤 다시 부르면 같은 작업(재시도 안전).
- 페이지 해시는 **서버 RPC 계층(`server-rpc.mjs`)이 받은 기록으로 계산**해 넘긴다(앱이 보낸 해시를 믿지 않음). SQL은 같은 순번 내용 비교로 변경을 거절한다.
- 조립된 봉투는 기존 검증(`normalize_workspace`)을 그대로 지난다 — FK·그림 참조·잠금·칸반 규칙 등 오류 코드 동일(시험: 없는 업무를 가리키는 기록 → `MIGRATION_FOREIGN_KEY`, 작업 생기지 않음).
- 큰 일지 시험 자료: `emit-workspace-fixture.mjs 20 --extra-items N`(가상 기록 N개 복제, 실제 업무 기록 아님).

## 2. 시험(로컬 PostgreSQL, 새 7개)

010 한 번만 적용 · 012 권한/RLS 점검 + 011 되돌리기 후 004 명령·007 검증 함수 원문 그대로 · 단일 요청 시작 회귀 · **5,052행 6페이지 업로드 → 시작 → 손실 없이 다시 읽기**(업로드 1.1초·시작 1.5초·읽기 1.2초) · 끊긴 업로드 이어서(빠진 페이지만)·변경 페이지/범위 밖/머리 변경 거절 · 다른 계정·클라이언트 역할 거절 · 한도(20,001행·기록 포함 머리)와 FK 검증 유지. [증거](evidence/migration-paged-upload-pass.json)

## 3. 개발 DB 적용 준비

- 검토 manifest `poc/v2-migration/postgres/paged-upload-review-manifest.json`(010·012·011 해시 고정, `autoApply: false`)
- 적용 도구 `poc/v2-migration/development/paged-apply.mjs --apply-010-development --free-usage-confirmed` — 007 있음·010 없음 확인 → 한 번 적용(응답 유실 시 재적용 없이 읽기 확인) → 012 점검 → 증거. 안전장치 시험(명시 실행·운영 거절·비밀값 없으면 요청 전 중단) 추가.
- **아직 적용하지 않았다.** 81문서 계획대로 C-1b(이미지)까지 로컬에서 끝낸 뒤 개발 DB 적용·버킷·gateway 재배포를 한 번에 한다.

## 4. 남은 C-1b

1. 이미지 한도 확장: 이관 자산 8 → 2,000개, 개당 64KiB → 10MB, 공간 합계 200MB — `wjb_migration.asset` 크기 제약, gateway 저장 모듈(`wjb_gateway`)의 예약·할당량
2. Storage **서명 업로드 주소** 발급 → 앱이 Storage에 직접 올림 → gateway가 받아 SHA-256·크기 재확인 → 정산(취소 울타리·부재 확인 그대로)
3. 앱이 부를 gateway HTTP 경로: 이관 명령(페이지 업로드 포함)·기기 등록 — 지금은 서버 안 시험 도구만 RPC를 부른다
4. 개발용 영구 private bucket `wjb-v2-dev-assets`
5. 개발 DB에 010(+C-1b SQL) 적용 → 실서버 검증
