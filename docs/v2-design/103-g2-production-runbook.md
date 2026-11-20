# 103. G-2 운영 서버 구축 — 절차서(2026-11-20 사용자 승인)

2026-11-17 · 브랜치 `v2-g-stage` · 97문서 G-2 · 결정 G-D2(운영 = `hutqsfftioxtredcjhsy`, 도쿄 `ap-northeast-1`, 무료 플랜)

> **이 문서가 승인되기 전에는 운영 프로젝트에 접속·쓰기·배포하지 않는다.** 승인 뒤에도 아래 순서 그대로, 단계마다 확인하고 다음으로 간다.

## 0. 리허설(개발에서 끝난 것)

| 대상 | 결과 |
|---|---|
| SQL 001~037을 빈 PostgreSQL 17에 이 순서로 | 로컬 117 통과(`evidence/migration-g6-metrics-pass.json`) — 단계마다 확인 SQL·되돌리기 포함 |
| 끝난 상태 점검(`poc/v2-ops/audit.mjs`) | 개발 서버 **12/12 통과**(2026-11-17 — 예전 gateway 비밀 삭제·관리 도구 secret 키·예전 API 키 끈 뒤 재확인, 99문서 4절) |
| 실서버 끝까지(`edge/live-paged-copy.mjs`) | 개발 gateway(새 비밀 키, `serverKey = secret`)로 로그인·업로드·그림·게시·읽기·공간 지우기·계정 삭제 **15/15 통과**, 남은 것 0 — 개발 프로젝트는 새 키만 씀 |
| 백업·복구(101) | 개발 서버 내보내기 → 로컬 일지 3개 되살려 열림 |

## 1. 도구 준비(코드, 운영 접속 없음) — 완료 2026-11-18

사용자 지시(2026-11-18)로 승인 전에 먼저 만들었다. 운영 프로젝트에는 접속하지 않았다.

- **대상 고르기 한 곳** `poc/v2-ops/target.mjs`: 첫 인자 `--<동작>-development|production` = `WJB_CLOUD_ENV`, 프로젝트 ID는 허용 표(G-3)로 고정, 변수는 그 환경 접두어(`DEV`·`PROD`)만 읽음(개발 도구가 운영 열쇠를 빌리지 않음), **운영 쓰기 = `WJB_CLOUD_ENV=production` + `--production-confirmed`**(읽기만은 확인 없음, 개발에 붙이면 거절), 운영 서버 열쇠는 새 `sb_secret_`만, 열쇠는 직렬화·로그에 안 나옴. 증거 파일은 운영 `prod-*.json`(개발 기록을 덮지 않음).
- **새 도구** `poc/v2-ops/setup.mjs` — 빈 프로젝트를 개발과 같은 파일·같은 순서로: 세션 보호 → gateway 기반(`postgres-metadata.sql`·`recovery.sql`, 개발 C단계 묶음에 들어 있던 것) → 000 사전 확인 → 001…037(단계마다 확인 SQL). 이미 있는 단계는 건너뛰고(다시 실행 안 함), 응답을 잃으면 다시 확인만, 중간에 멈추면 다음 실행이 이어 감. 실행할 수 있는 파일 = `poc/v2-ops/production-manifest.json`의 SHA-256(32개)과 같은 것만. 되돌리기 파일은 실행하지 않음(사람이 2절 표대로).
- **리허설**(`setup.test.mjs`): 빈 PostgreSQL 17(Docker, 고정 이미지, 네트워크 없음)에 같은 단계 목록 → 010에서 일부러 멈춤 → 이어서 끝까지 → 다시 돌려도 그대로 → 버킷 만들기·설정 다름 감지, 개발·운영 섞임 거절 시험 포함 **6/6**. 개발 서버에 `--plan-development`(읽기만) → 16단계 모두 "있음"(개발이 같은 순서로 세워졌다는 확인).
- **운영 줄 추가**: `audit.mjs --audit-production` · `export.mjs --export-production <폴더>` · `edge/deploy.mjs --deploy-production --production-confirmed` · `admin-set.mjs --set-admin-production --production-confirmed` · `dev-signup-admin.mjs --status-production`·`--invite-production <이메일> --production-confirmed`·`--signup-production invite --confirm --production-confirmed` · `edge/live-paged-copy.mjs --run-production --production-confirmed`(공개 키는 9단계 전이라 `WJB_SUPABASE_PROD_PUBLISHABLE_KEY`). 개발 명령은 그대로 — 바꾼 뒤 개발에서 `audit` 12/12 · 실서버 점검 15/15 · 내보내기(공간 3·기록 93·그림 2) · 가입 상태 확인 다시 통과, 도구 시험 59/59(`setup`·`guards`·`server-key`·`audit`·`metrics-report`).
- 운영 그림 버킷 이름 `wjb-v2-assets`(gateway `ASSET_BUCKETS`에 이미 있음), 설정은 개발과 같음(비공개·10MB·`application/octet-stream` — gateway가 그 형식으로만 올림).
- 운영에 필요한 이 작업 환경 변수(값은 사용자가 Settings에서, 저장소에 없음): `WJB_SUPABASE_PROD_MANAGEMENT_TOKEN`(`sbp_`) · `WJB_SUPABASE_PROD_SERVICE_ROLE_KEY`(5단계에서 만든 관리 도구용 `sb_secret_`) · `WJB_SUPABASE_PROD_PUBLISHABLE_KEY` · `WJB_ADMIN_EMAIL`. 운영 명령을 돌리는 세션만 `WJB_CLOUD_ENV=production`.
- **운영 변수 4개 준비 확인(형식만, 2026-11-20, 운영 접속 없음)**: 관리 토큰 `sbp_`·서버 키 `sb_secret_`·공개 키 `sb_publishable_`·관리자 이메일 형식 맞음, `WJB_SUPABASE_PROD_PROJECT_REF` = `hutqsfftioxtredcjhsy`, 운영·개발 관리 토큰 서로 다름, `WJB_CLOUD_ENV` = `development` 그대로·개발 변수 그대로. 요청 없는 `opsTarget` 판정(`--plan-production` 통과·`--export-production <폴더>` 관리+서버 키 통과·운영 쓰기 확인 없으면 거절) + 도구 시험 59/59. 키가 실제로 유효한지는 2절 이후 확인. 이어서 사용자 승인으로 `--plan-production`(읽기만, 증거 파일 없음) 1회: 관리 토큰 동작(200), `ap-northeast-1`·`ACTIVE_HEALTHY`, 적용된 단계 0개(다음 `session-guard`), wjb 스키마 없음, pg_cron 사용 가능, 버킷 `wjb-v2-assets` 없음 — 빈 프로젝트 확인.

## 2. 운영 적용 순서

| # | 단계 | 누가 | 확인 | 되돌리기 |
|---|---|---|---|---|
| 1 | 플랜·리전·빈 프로젝트 확인(읽기만) — `setup.mjs --plan-production` | 저 | 무료 · `ap-northeast-1` · `wjb_*` 스키마 없음 | — |
| 2 | `setup.mjs --apply-sql-production --production-confirmed`: 세션 보호(`v2-cloud/session-guard.sql`)·gateway 기반(`postgres-metadata.sql`·`recovery.sql`)·SQL 001 → 004 → 007 → 010 → 013 → 016 → 019 → 022 → 025 → 028 → 031 → 034 → 037 | 저 | 각 확인 SQL(002·005·008·012·014·017·020·023·026·029·032·035·038) | 각 되돌리기(003·006·009·011·015·018·021·024·027·030·033·036·039) — 자료 없는 동안만 |
| 3 | 비공개 버킷 `wjb-v2-assets` — `setup.mjs --bucket-production --production-confirmed` | 저 | `public=false`, 크기 제한 10MB, `application/octet-stream`(개발과 같음) | 빈 버킷 지우기 |
| 4 | 인증: 이메일 인증번호만 · **가입 끔(초대 전용)** · 인증번호 메일 템플릿(`mockups/email-otp/final-otp.html`, 제목 `Work Journey Board 로그인 인증번호`) · SMTP(Resend, 인증한 도메인 보내는 주소) | 사용자(대시보드) | `audit` signup·template | 대시보드에서 되돌림 |
| 5 | API 키: secret 키 `wjb_gateway` 만들기 — **예전 키는 처음부터 끔** | 사용자(대시보드) | gateway 시작 401 | 새 키 다시 만들기 |
| 6 | gateway 배포 `deploy.mjs --deploy-production --production-confirmed` → 실서버 점검 `live-paged-copy.mjs --run-production --production-confirmed` | 저 | `audit` gateway_answers · 실서버 점검(가상 계정, 끝나면 정리) | 직전 판 다시 배포 / 함수 지우기 |
| 7 | 관리자 초대 `dev-signup-admin.mjs --invite-production <이메일> --production-confirmed` → 지정 `admin-set.mjs --set-admin-production --production-confirmed`( 이메일은 `WJB_ADMIN_EMAIL` 변수로만 — 저장소·증거에 없음) | 사용자 로그인 → 저 | `audit` admin_set | 관리자 줄 지우기 |
| 8 | 예약: KeepAlive(50문서 SQL) · 안 쓰는 그림 정리 · 측정 — `setup.mjs --schedule-production --production-confirmed` | 저 | `audit` cron 3개 | `cron.unschedule` |
| 9 | 앱 서버 표에 운영 공개 키(`online.rs` `PRODUCTION.publishable_key`) — 정식판 반영(G-1·G-9) 커밋에서 | 저 | Rust 시험(운영 준비 완료) | 키 빼기 |
| 10 | 복구 리허설: 운영 내보내기 `export.mjs --export-production <폴더>` → 로컬 일지로 되살리기(101) · 끝 점검 `audit.mjs --audit-production` | 저 | 되살린 일지 열림 | — |

### 2-1. 진행 기록

| # | 날짜 | 결과 | 증거 |
|---|---|---|---|
| 1 | 2026-11-20 | `ap-northeast-1`·`ACTIVE_HEALTHY`, 빈 프로젝트 | (읽기만, 파일 없음) |
| 2 | 2026-11-20 | 세션 보호·gateway 기반 2개·SQL 001…037 13개 = 16단계 적용, SQL 13개 확인 통과 → 다시 읽기: 16단계 모두 있음, 스키마 `wjb_gateway`·`wjb_life`·`wjb_migration`·`wjb_ops`·`wjb_sync`·`wjb_v2_cloud` | `evidence/prod-setup-apply-sql.json` |
| 3 | 2026-11-20 | `wjb-v2-assets` 만듦, 설정 개발과 같음(`matches`) | `evidence/prod-setup-bucket.json` |
| 4·5 | 2026-11-20 | 사용자 대시보드 설정 → 읽기 확인: 가입 끔·이메일 인증번호 양식(`{{ .Token }}`, 8자리·1시간)·SMTP `smtp.resend.com`:465 `resend`·보내는 주소 = 인증 도메인·시간당 30통 · API 키 secret `wjb_gateway`·`wjb_admin_tools`, 예전(legacy) 키 꺼짐 | (읽기만) |
| 6 | 2026-11-20 | `wjb-gateway` v1 배포(ACTIVE, 로그인 없이 401) → 실서버 점검 **15/15 통과**(`serverKey = secret`·`production`), 정리 잔여 0 | `evidence/prod-gateway-deploy.json` · `evidence/prod-paged-copy-live.json` |
| 7 | 2026-11-20 | `WJB_ADMIN_EMAIL` 계정 초대(만듦, 확인된 계정이라 로그인 양식으로 바로 로그인) → 관리자 1명 지정, 계정 1 | `evidence/prod-admin-set.json` |
| 8 | 2026-11-20 | 예약 `keepalive_ping`·`wjb-life-sweep`(`10 18 * * *`)·`wjb-ops-metrics`(`50 14 * * *`), 첫 측정 | `evidence/prod-setup-schedule.json` |
| 점검 | 2026-11-20 | `audit.mjs --audit-production` **12/12 통과** (8단계 전에는 `cron.job` 표가 없어 도구가 오류 응답을 처리하지 못하고 멈춤 — 도구 보완 필요) | (출력만) |
| 9·10 | — | 9 = 정식판 반영 커밋에서, 10 = 복구 리허설 대기 | — |

## 3. 끝난 기준

`audit --audit-production` 12개 모두 통과 · 실서버 점검 통과·남은 것 0 · 복구 리허설 통과 · 사용자 본인 계정으로 앱 로그인·공간 하나 만들기·다른 기기 동기화(실기).

## 4. 하지 않는 것

- 개발 프로젝트의 자료를 운영으로 옮기지 않는다(운영은 빈 상태에서 시작 — 사용자가 앱에서 다시 올림).
- 운영에서 시험 계정은 실서버 점검이 만든 가상 계정만, 끝나면 지운다.
- 관리 토큰·비밀 키·관리자 이메일은 저장소·증거·채팅에 두지 않는다.
