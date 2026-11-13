# 77. 이관 저널 v4 — DB20 프로필 연결

2026-11-13 · `v2-design` · 기준 제품 앱 1.40.0 / 일지 구조 v20 · 로컬 PoC(클라우드 미적용)

## 1. 왜 필요했나

[76문서](76-db20-server-profile.md)로 서버는 DB20 봉투를 받을 수 있게 됐지만, 기기 쪽 이관 저널(`poc/v2-migration/journal.mjs`)의 `workspace_binding.target_profile` CHECK가 DB18/19만 허용해 **실제 이관 세션이 DB20을 끝까지 진행할 수 없었다.** SQLite는 CHECK를 그 자리에서 바꿀 수 없으므로 저널 구조를 3 → 4로 올리는 전진 업그레이드를 넣었다.

## 2. 바꾼 곳

| 파일 | 변경 |
|---|---|
| `journal.mjs` | `user_version` 4 추가. 3 → 4에서 `workspace_binding`을 새 CHECK(18/19/20)로 다시 만들고 **모든 행을 옮긴 뒤 옮기기 전과 해시가 같은지·외래 키가 온전한지 확인**(어긋나면 `JOURNAL_UPGRADE_MISMATCH`로 전체 되돌림). 받을 수 있는 버전 1~4. 바인딩 허용 프로필은 공통 목록 `journalWorkspaceProfiles` 하나로 |
| `workspace-session-fixture.mjs` | 가상 표본에 DB20(75문서의 `upgradeFixture` 그대로) |
| `workspace-session-pg-client.mjs` | 표본 구조 번호 선택(18/19/20, 기본 19) |
| `postgres/db20-workspace-tests.py` | 007 적용 PostgreSQL 위에서 DB20 세션 3가지 응답 유실 시나리오 |
| 기존 시험 | 저널 버전 기대값 3 → 4 |

이전 저널 파일(1·2·3)은 열 때 순서대로 4까지 올라간다. 이미 만든 작업·자산·바인딩·저장 기록은 그대로 남는다. 업그레이드 뒤 이전 판 PoC 코드로 다시 여는 것은 지원하지 않는다(버전 4를 모름 → `NOT_MIGRATION_JOURNAL`로 열지 않음, 자료는 그대로).

## 3. 검증

- JS V2 회귀 **324개 통과**(새 2개)
  - DB20 가상 공간: 원본 해시·매핑 해시·서버 해시 3중 바인딩, `poc-verified`에서 멈추고 제품 활성화 안 함, 원본 그대로
  - 옛 CHECK의 버전 3 저널(DB19 바인딩 1건)을 열면 4로 올라가며 바인딩·작업이 그대로이고, 새 CHECK에 DB20이 들어가며 무결성 검사 통과(옛 CHECK는 DB20을 거절함을 먼저 확인)
- 로컬 PostgreSQL 17.11 **108개 통과**(새 3개): 실제 HTTP → PostgreSQL(007 적용) + v4 저널로 DB20 공간의 시작·게시·취소 응답을 일부러 잃어도 저널을 다시 열어 같은 결과로 맞춤(64KiB 넘는 메타데이터)
- ESLint·Prettier 통과 · [PG 시험 목록](evidence/db20-workspace-server-postgres.txt) · [실행 증거·해시](evidence/migration-db20-workspace-pass.json) · 검토 manifest(`poc/v2-migration/postgres/db20-review-manifest.json`, `journalSchema: 4`)

## 4. 다음

**개발 DB 적용(사용자 확인 필요)** — 007 적용 → 008 점검 → 가상 DB20 표본(계정·공간·작은 이미지)으로 실제 Auth/Storage 이관 → 모든 표본 정리 → 잔여 0 확인. 66문서와 같은 절차이며 001·004·KeepAlive는 다시 적용하지 않는다. 운영 예정 프로젝트·제품 앱·원본 로컬 모델은 그대로다.

## 5. 개발 DB 적용 준비 (2026-11-13 — 6절에서 실행 완료)

사용자가 개발 DB 적용을 승인했으나, 이 세션은 기본(Default) 환경에서 실행되어 개발 DB 비밀값(`WJB_SUPABASE_DEV_SERVICE_ROLE_KEY`·`WJB_SUPABASE_DEV_MANAGEMENT_TOKEN`)과 개발 호스트 허용이 없다. 연결된 Supabase 도구는 다른 계정(건물수첩 프로젝트)이라 사용하지 않았다. **클라우드에는 아무것도 적용하지 않았다.** 대신 바로 실행할 수 있게 도구를 준비했다.

| 도구 | 내용 |
|---|---|
| `poc/v2-migration/development/db20-apply.mjs --apply-007-development --free-usage-confirmed` | 개발 환경·007/008 해시(검토 manifest) 확인 → 쓰기 역할·비superuser 확인 → 004 있음·007 없음 확인 → 007 한 번 적용(응답 유실 시 다시 적용하지 않고 읽기로 확인) → 008 점검 → `evidence/migration-dev-db20-install.json` |
| `live-check.mjs --run-development-fixtures --free-usage-confirmed --db20` | 기존 DB18/19 흐름 그대로, 표본만 DB20 3건(정상·준비/게시 응답 유실 복구·취소). 007 설치 기록·해시와 008 점검 선행, 30테이블·`kanban_ctx` 제외·칸반 테이블 왕복 확인, 기존과 같은 정리·잔여 0 확인 → `evidence/migration-dev-db20-live-check.json` |
| `guards.test.mjs` | 새 도구·`--db20`의 명시 실행·운영 선택 거절·비밀값 없을 때 요청 전 중단 시험 추가(11개 통과) |

실행에 필요한 것: 개발 DB 변수가 있는 환경(이전 개발 DB 작업 세션의 환경)에서 실행하거나, 이 저장소용 환경에 아래를 설정한다 — 일반 변수 `WJB_CLOUD_ENV=development`·`WJB_SUPABASE_DEV_PROJECT_REF=vsphftnmfzfoufasjttd`, 비밀 변수 `WJB_SUPABASE_DEV_SERVICE_ROLE_KEY`·`WJB_SUPABASE_DEV_MANAGEMENT_TOKEN`, 허용 호스트 `api.supabase.com`·`vsphftnmfzfoufasjttd.supabase.co`.

## 6. 개발 DB 적용·실검증 결과 (2026-11-14 KST, 완료)

개발 DB 변수가 있는 환경에서 승인 범위대로 실행했다. 대상은 개발 프로젝트 `vsphftnmfzfoufasjttd`뿐이며 **운영 예정 프로젝트·제품 앱·원본 로컬 모델은 건드리지 않았다.** 001·004·KeepAlive는 다시 적용하지 않았다.

| 단계 | 결과 |
|---|---|
| 첫 실행 | 점검(preflight) 읽기 조회가 HTTP 400으로 멈춤(쓰기 전 단계, 적용 없음). 원인 = API `read_only: true`는 `supabase_read_only_user`로 실행되어 비공개 함수 `wjb_migration.workspace_contract` 실행 권한이 없음(42501) |
| 도구 수정 | `db20-apply.mjs`의 점검 조회를 소유자 역할(`postgres`, 005 점검과 같은 연결) + `SET TRANSACTION READ ONLY` 트랜잭션으로 실행. 같은 방식에서 `CREATE TABLE`이 25006으로 거절되고 시험 테이블이 생기지 않음을 먼저 확인. 안전장치 시험 11개 다시 통과 |
| 007 적용 | 실행 역할 `postgres`(쓰기, 비superuser) · 사전 004 있음/007 없음/DB20 작업 0 → 007 **한 번** 적용 성공(응답 유실 없음) |
| 008 점검 | DB20 계약 있음·30테이블·`job_profile_check`에 DB20 프로필·`wjb_migration` 테이블 5/RLS 5·서버 RPC만(클라이언트 RPC 없음)·직접 테이블 접근 없음·비공개 함수 실행 권한 없음·안전하지 않은 search_path 없음 → [설치 증거](evidence/migration-dev-db20-install.json) |
| 실검증(`live-check --db20`) | **51개 검사 모두 통과** — 설치 기록·해시 대조(001·004·007·008), 가상 계정 2개 로그인·서명 확인, private 버킷 생성·한도, DB20 표본 3건(정상 / 준비·게시 응답 유실 복구 / 준비·삭제 응답 유실 후 취소): 30테이블 채움·물리 업로드 1회·원본 그대로·원본/온라인 manifest 해시 분리·메타데이터에 이미지 본문 없음·전체 왕복·칸반 테이블 왕복·삭제 잠금 유지·다른 계정 거절(RPC·Storage 직접)·취소 후 할당량 0. 요청 147회, Storage 업로드 3회(204바이트) → [실검증 증거](evidence/migration-dev-db20-live-check.json) |
| 정리 | 객체·버킷·메타데이터·시험 계정 잔여 0(도구 확인) + 별도 읽기 조회로 다시 확인: 작업 0·공간 기록 0·버킷 0·객체 0·시험 계정 0, 007 계약 남음, DB 크기 약 12.2MB |

메일 발송·공개 gateway 배포·운영 접속 없음. 기존 install/KeepAlive 재실행 금지는 그대로다. 다음은 74문서 순서대로 남은 DB20 미지원 차이와 제품 연결 단계다.
