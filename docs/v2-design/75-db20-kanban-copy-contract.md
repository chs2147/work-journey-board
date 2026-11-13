# 75. DB20(칸반) 사본 이관 계약

2026-11-13 · `v2-design` · 기준 제품 앱 1.40.0 / 일지 구조 v20 · 독립 PoC(제품·클라우드 변경 없음)

## 1. 왜 필요했나

main 1.30.0부터 `0020_kanban.sql`이 칸반 테이블 4개와 `entry_item.kanban_section_id` 열을 더했고, 1.35·1.40은 일지 설정에 칸반 배치·섹션 순서·아이콘을 더했다. 실제 사용자 일지는 이미 v20인데 V2 이관 PoC는 v18·v19만 받아 **v20 일지를 원본은 건드리지 않고 `SCHEMA_VERSION`으로 거절**하고 있었다(74문서 4절). 이번에 62문서(DB19)와 같은 1단계 — 로컬 사본·매핑·복원 왕복 — 를 DB20으로 넓혔다.

## 2. 테이블별 계약

| 대상 | 온라인 사본 | 이유·검사 |
|---|---|---|
| `kanban_section` | 그대로 매핑 | 사용자 섹션(이름 1~20자·색·순서). TODO·DONE은 행이 없음 |
| `entry_item.kanban_section_id` | 그대로 매핑 | 외래 키(`ON DELETE SET NULL`) — 계약의 FK 검사 대상 |
| `item_status_log` | 그대로 매핑(전체 보관) | 상태 변경 이력. 외래 키가 없는 것이 제품 설계(항목을 지워도 이력 유지, 지운 섹션은 옛 id·"(지운 섹션)" 이름으로 남음) — 존재 검사 대신 **형식 검사**: 출처 7종·ISO 시각·키 64자 이하·from≠to |
| `kanban_bulk` | 그대로 매핑 | 일괄 완료 되돌리기 자료. `items` JSON을 `[항목 id, ISO 시각]` 쌍 배열·쌍 수 ≥ `count`·`undone_at` 형식으로 검사 |
| `kanban_ctx` | **제외**(`local-write-context`) | 저장소가 쓰기 묶음 동안만 바꾸는 트리거용 한 줄. 쉬는 상태 `{id:1, source:'board', batch_id:null, at:null}`가 아니면 **쓰기 도중 끊긴 일지로 보고 추출 자체를 거절**(`KANBAN_WRITE_IN_PROGRESS`). 복원 대상 스키마가 같은 줄을 다시 만든다 |
| `settings.ui.kanbanColumns` | **유지**(`ui.kanbanColumns`만) | 섹션 순서·아이콘 = 섹션 id를 가리키는 공간 내용. 순서 키는 `todo`·`done`·있는 섹션 id만, 중복 금지, 아이콘 값은 제품 생성물(`src/shared/sectionIcons.ts`)의 36개 id만(`KANBAN_COLUMNS_REFERENCE`) |
| `settings.ui.kanbanLayout`·`startView`·그 밖 `ui` | 제외(기존 규칙) | 화면 크기·기기에 묶인 값. 제외 기록에 `kept: ["kanbanColumns"]` 표시 |

DB18·DB19 경로와 계약 파일(`db18-contract.json`·`db19-contract.json`)은 바뀌지 않았다. 새 `db20-contract.json`은 30테이블(기존 26 + 칸반 4)이며 프로필은 `workspace-db20-map-poc-1`이다.

## 3. 바꾼 곳

| 파일 | 변경 |
|---|---|
| `poc/v2-sync/db18.mjs` | 지원 구조 `SUPPORTED_SCHEMAS = [18, 19, 20]`, 삭제 잠금 검사 19 이상, DB20 쓰기 문맥 쉬는 상태 검사 |
| `poc/v2-migration/workspace-map.mjs` | 버전별 계약·프로필 표, 칸반 이력·일괄 자료·열 설정 검사, `kanban_ctx` 제외 |
| `poc/v2-migration/build-db18-contract.mjs` | 18·19·20 계약 생성, SQLite 내부 테이블 제외 |
| `poc/v2-assets/connected-copy.mjs` | 사본 manifest 허용 구조에 20 |
| `poc/v2-assets/restore-connected-copy.mjs` | **복원 버그 수정**: `sqlite_sequence`(DB20 상태 이력의 `AUTOINCREMENT`가 만드는 SQLite 내부 테이블)까지 지우고 다시 넣으려던 문제 — 내부 테이블은 건너뛰고, 명시한 id로 넣어 순번이 이어지게 함 |
| `poc/v2-migration/fixture-db20.mjs`(새) | 실제 0019·0020 마이그레이션 + 앱과 같은 순서의 칸반 쓰기(섹션 2개·이동·일괄 완료·지운 섹션 이력·열 설정) 가상 표본 |
| `poc/v2-migration/emit-workspace-fixture.mjs` | 20 표본 출력 |
| `poc/v2-migration/db19-compat.test.mjs` | "모르는 구조" 시험 값을 20 → 21로(20이 이제 지원 구조) |

서버 쪽(`server-rpc.mjs` 프로필 목록, `postgres/004-workspace.sql`)은 **이번에 바꾸지 않았다.** DB20 봉투는 서버 호출 전에 `MIGRATION_PROFILE_UNSUPPORTED`로 막히며(시험으로 확인, 전송 0회), 서버 계약은 다음 단계다.

## 4. 검증

새 시험 11개(`poc/v2-migration/db20-compat.test.mjs`):

1. DB20 추출 → 사본 → 복원 왕복에서 전체 행·이미지·스키마 일치, 원본 해시·폴더 그대로, 원본 경로로 복원 거절
2. 봉투: 프로필·계약 지문, 칸반 3테이블 포함, `kanban_ctx` 제외 기록, `ui`는 `kanbanColumns`만·내보내기 경로/자유 배치 좌표 없음, 지운 섹션 이력 유지
3. 복원한 DB에서 트리거가 살아 있음: 섹션 이동 → 이력 한 줄(이름 "보류", 출처 board), 순번이 복원된 최대 id 뒤로 이어짐, 섹션 삭제 시 항목 섹션 NULL
4~7. 쓰기 도중 끊긴 일지 · 모르는 아이콘 · 없는 섹션을 가리키는 순서 · 깨진 일괄 자료 → 거절, 원본 불변
8. 깨진 칸반 자료의 사본은 복원도 거절, 출력 파일 없음
9. DB19를 기대하는 판독기의 DB20 거절, 모르는 DB21 거절(출력 없음·원본 그대로)
10. 계약 = 실제 마이그레이션으로 만든 30테이블 스키마, 칸반 FK 포함
11. 서버 RPC는 DB20 프로필을 전송 전에 거절

기존 V2 회귀 311개와 합쳐 **322개 통과**, ESLint·Prettier 통과. [시험 출력](evidence/db20-compat-js.txt) · [해시·집계](evidence/db20-compat-pass.json). PostgreSQL·Rust·실제 Cloud 시험은 소스가 바뀌지 않아 다시 돌리지 않았다.

## 5. 정해 둔 점·남은 점

- **상태 이력 온라인 보관 = 전체**(74문서 Q3 추천 반영). 행이 작고 로컬과 같은 내용을 유지한다.
- **이력 `id`는 원본 기기의 순번**이다. 1회 사본 이관에서는 문제가 없지만, 7번(여러 기기 동기화)에서는 기기마다 순번이 겹치므로 이력에 전역 id(또는 `원본 기기 + 순번`)가 필요하다 — 7번 설계 항목으로 넘긴다.
- **후속: 서버 확장은 [76문서](76-db20-server-profile.md)에서 로컬 검증 완료.** 당시 계획: `workspace-db20-map-poc-1`을 서버 프로필에 더하고 전진 SQL(004 계열)에 칸반 4테이블·열 검증을 넣은 뒤 로컬 PostgreSQL → DEV 순으로 검증한다. 이미 설치된 DEV 모듈은 다시 설치하지 않고 새 전진 파일로만 넓힌다.
- 제품 앱·원본 로컬 모델은 그대로다. 로컬 영구 유지·원본 보존·온라인 DB 이미지 본문 금지 원칙(56문서)을 그대로 따른다.
