# 76. DB20(칸반) 서버 프로필·전진 SQL

2026-11-13 · `v2-design` · 기준 제품 앱 1.40.0 / 일지 구조 v20 · 로컬 PostgreSQL 17 PoC(클라우드 미적용)

## 1. 범위

[75문서](75-db20-kanban-copy-contract.md)의 DB20 봉투(`workspace-db20-map-poc-1`)를 서버가 직접 검증·저장·재조회하도록 넓혔다. 63문서(DB18/19 서버 프로필)와 같은 2단계다. **개발 DB에 이미 설치된 001·004는 한 바이트도 바꾸지 않고**, 새 전진 파일로만 넓힌다.

| 파일 | 역할 |
|---|---|
| `007-workspace-db20.sql`(새) | 004 위에 한 번만 적용. 프로필 CHECK에 DB20 추가, 계약 함수를 18·19·20으로 교체, 봉투 검증 함수에 DB20 분기 추가, 프로필 분기 함수 교체. 004가 없거나 이미 적용했으면 멈춤(`MIGRATION_004_REQUIRED`·`MIGRATION_007_ALREADY_APPLIED`) |
| `008-workspace-db20-verify.sql`(새) | SELECT만 — DB20 계약 30테이블, CHECK, 5테이블 RLS, 직접 접근·비공개 함수 실행·검색 경로 점검 |
| `009-workspace-db20-rollback-empty.sql`(새) | DB20 작업 이력이 하나도 없을 때만 004 함수 원문·CHECK로 되돌림. 아무것도 지우지 않음(`MIGRATION_DB20_ROLLBACK_NOT_EMPTY`) |
| `db20-review-manifest.json`(새) | 검토용 해시 묶음 — `autoApply:false`, `cloudApplied:false` |
| `build-workspace-sql.py` | 위 세 파일 생성. **DB18/19 분기는 004 원문에 DB20 전용 줄만 덧붙이는 치환**으로 만들고, 치환 대상이 정확히 한 번 있는지 확인. 004·006 출력은 이전과 바이트 단위로 같음(git 변화 없음 확인) |
| `server-rpc.mjs` | 전체 프로필 목록에 DB20, 프로필↔구조 번호 대응표(18/19/20). 서버에 007이 없으면 서버 CHECK가 계속 막음 |
| `run-local.py` | `--db20` 선택지. Docker Hub 요청 한도(429) 때문에 **같은 digest의 공식 미러**(`mirror.gcr.io/library/postgres@sha256:665dc7…`)도 허용 — 다른 이미지·태그는 받지 않음 |

## 2. 서버가 새로 검사하는 것 (DB20만)

| 대상 | 검사 | 오류 코드 |
|---|---|---|
| `kanban_ctx` | 레코드로 오면 거절, 통계는 원본 1·매핑 0·제외 1, 제외 기록 `local-write-context` 정확히 1건 | `MIGRATION_KANBAN_CONTEXT`·`MIGRATION_ROW_COUNTS`·`MIGRATION_EXCLUSION` |
| `kanban_section` | 이름 1~20자 | `MIGRATION_KANBAN_FORMAT` |
| `item_status_log` | 출처 7종, ISO 시각, 키 1~64자, from≠to (외래 키 없음은 제품 설계 그대로) | `MIGRATION_KANBAN_FORMAT` |
| `kanban_bulk` | `items` = `[문자열 id, ISO 시각]` 쌍 배열, 쌍 수 ≥ `count`, `undone_at` 형식 | `MIGRATION_KANBAN_FORMAT` |
| `entry_item.kanban_section_id` | 계약의 외래 키로 섹션 존재 확인 | `MIGRATION_FOREIGN_KEY` |
| 설정 `ui` | DB20에서만, `{kanbanColumns:{order,icons}}` 하나만. 순서 = `todo`·`done`·있는 섹션 id, 중복 없음 · 아이콘 = 제품 36종(생성 시 `src/shared/sectionIcons.ts`에서 읽어 SQL에 고정) · `kanbanLayout` 등 다른 키는 거절 | `MIGRATION_KANBAN_REFERENCE`·`MIGRATION_SETTINGS` |
| 제외 기록 | `settings.ui`에만 `kept:["kanbanColumns"]` 허용 | `MIGRATION_EXCLUSION` |

DB18/19 봉투는 007 뒤에도 이전과 같은 규칙이다(예: DB19 봉투에 `ui`가 오면 계속 `MIGRATION_SETTINGS`).

## 3. 검증 (로컬 PostgreSQL 17.11, 네트워크 없음)

`python3 poc/v2-migration/postgres/run-local.py --full-workspace --db20 --evidence-stem migration-db20-workspace`

- 기존 80개(최소문서·전체 프로필·저널 HTTP) 다시 통과 — 004만 있을 때 DB20을 거절하는 기존 시험 포함
- 새 25개
  - 007 적용·두 번째 적용 거절
  - 008 점검, 009 빈 상태 rollback이 004 함수 원문·CHECK를 정확히 되돌리고 DB18/19 작업은 보존
  - DB20 봉투 30테이블 저장·무손실 재조회·재요청 동일 해시·이미지 확인 뒤에만 게시·취소 시 connected 유지
  - 007 뒤 DB18·DB19 봉투 그대로 저장·재조회
  - 잘못된 DB20 봉투 17종 원자적 거절(작업·공간 생성 0): 쓰기 문맥 레코드, 제외 누락, 통계 어긋남, 섹션 이름, 이력 출처·변화 없음·시각 형식, 일괄 자료 형식·개수, 없는 섹션 지정, 순서의 없는 섹션·중복, 모르는 아이콘, 기기별 배치, 다른 제외의 `kept`, 프로필·구조 불일치, DB21
  - DB19 봉투의 `ui` 거절, 다른 계정·클라이언트 역할의 DB20 조회 거절, DB20 사용 뒤 009 rollback 거절(자료 보존)
- **합계 PostgreSQL 105개 통과** · JS V2 회귀 322개 통과(서버 RPC 시험을 "DB20은 프로필 허용 시에만·구조 번호 일치 시에만 전송"으로 갱신) · ESLint·Prettier 통과

[PG 시험 목록](evidence/db20-workspace-server-postgres.txt) · [실행 증거·소스 해시](evidence/migration-db20-workspace-pass.json) · [검토 manifest](../../poc/v2-migration/postgres/db20-review-manifest.json)

## 4. 남은 것

1. **개발 DB 적용(사용자 확인 필요)**: 007 → 008 확인 → 가상 DB20 표본 이관·정리. 66문서와 같은 절차이며 001·004·KeepAlive는 다시 적용하지 않는다. 실제 클라우드 쓰기이므로 이번에는 하지 않았다.
2. **로컬 이관 저널(`journal.mjs`)의 DB20 프로필**: 저널 테이블 CHECK가 DB18/19만 허용해 저널 버전 4로 올리는 보존 업그레이드가 필요하다(64문서 방식). 이것이 끝나야 실제 이관 세션이 DB20을 끝까지 돌 수 있다.
3. 7번(여러 기기 동기화)에서 상태 이력 id 전역화.

제품 앱·운영 예정 프로젝트·원본 로컬 모델은 바뀌지 않았다. 로컬 영구 유지·원본 보존·온라인 DB 이미지 본문 금지 원칙(56문서)을 따른다.
