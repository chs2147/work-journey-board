# V2 프로젝트 — 다국어·온라인 동기화 상세 설계 초안

**현재 제품 기준:** [61. main 1.24.1 동기화](61-main-1.24.1-sync-checkpoint.md). main의12개 커밋을 반영했으며 앱1.24.1/DB19다. V2 이관 PoC는 DB18 전용이므로 다음은 DB19 계약/삭제 잠금 보존 검증이다. 아래 단계별 결과는 당시 기준이다.

**최신 진행:** [60. DB18 전체 매핑·RPC 연결](60-db18-workspace-map-gateway.md). 매핑17개·HTTP16개·실제PG40개 통과. 전체 봉투의 서버 저장/실제 Storage 연결은 다음 단계이며 Cloud 미적용이다.

**최신 진행:** [59. PostgreSQL 이관 서버](59-postgres-migration-server.md)의 실제PG39개 통과. 신규 SQL은 검토안이며 DEV 미적용, 최소문서프로필의 증표는 제품활성화에 쓸 수 없다. 다음은 전체DB18mapper·실제gateway연결이다.

**최신 진행:** [58. 이관 영속 상태·재개·취소](58-durable-migration-resume-cancel.md) PoC103개 통과. journal에는 이미지 본문 없이 상태만 저장하며 원격은 테스트 어댑터다. 다음은 실제 PostgreSQL 이관 테이블/RPC와 도메인 매핑이다.

**최신 진행:** [57. 실행 격리·이관 완료 연결](57-runtime-isolation-and-migration-handoff.md) PoC71개 통과. 로컬/온라인 설정·업데이트 후보 경계와 원본 폴더 보호를 검증했다. 실제 native 배포/서버 이관 완료 기능은 미구현이다.

**최상위 철칙:** [56. 로컬 영구 유지·새 온라인 사본·DB/Blob 분리](56-local-permanence-copy-migration.md). 로컬 원본 구조/이미지는 그대로 유지하며 온라인 사본에만 이미지 참조형 DB와 Blob을 적용한다. 사용자 명시적 포기 전 로컬 모델을 영구 지원한다. 신규 독립 추출22개+DB18회귀19개 통과, 실제 제품 이관은 후속 단계다.

**최신 검증(2026-11-10 KST):** [55. Supabase private 파일 실검증](55-supabase-private-storage-live-results.md). DEV Free/Usage 사용자 확인 후 실제 Auth/DB/Storage/loopback gateway47검사와 생성 데이터 정리를 완료했다. 다음은 V1/V2 격리·제품용 이미지/dedup PoC이며 공개 배포/실기 동기화는 남아 있다. 아래 이전 체크포인트의 대기 표시는 작성 당시 상태다.

**저장소 확정:** 첫 온라인 Blob은 [Supabase private Storage](54-supabase-storage-decision.md)다. 기존 월0원 기준으로 DEV Free/Usage와 실제 파일 검증을 완료했다. Pro 전환은 별도 결정이다.

**최신 상태(2026-11-10 KST):** 개발 DB/KeepAlive 설치 후 [52. 실제 개발 인증 검증](52-development-auth-live-results.md)까지 완료했다. 실제 계정2개 로그인·서명·세션 회수·공간 격리를 확인하고 시험 데이터를 제거했다. 제품/실기 동기화·Blob 저장소/파일 전송·공개 gateway는 미완료이며 main/기존 로컬 모델은 유지한다. 아래 초기 미착수 표시는 작성 당시 기록이다.

**일시 중단·재개 안내(2026-11-09):** [RESUME.md](RESUME.md)에 완료 범위·정확한 차단 조건·재개 순서를 기록했다. V2는 v2-design에 보존했으며, 복귀 후 main 1.23.1 패치를 이 브랜치에 병합했다.

2026-11-08 (KST) · 설계·독립 로컬 모형 `v2-design` · 기준 `bfbc98f` / 앱1.23.0 / DB18

**현재 단계: 설계 및 독립 로컬 모형·DB18 전환·삭제·복원·장기 오프라인 로컬 검증(25~30문서). 제품 구현·클라우드 통합은 미착수다. 아래 추천은 미확정이며 구현·데이터 전송·마이그레이션·클라우드 생성·배포를 승인받은 것으로 해석하지 않는다.** V2는 프로젝트 명칭이고 정식 앱 버전2.0.0의 확정이 아니다. main 및 현재 제품의 Feature List·앱 버전은 유지한다.

## 진행 요약 보고서

[PoC 구현 전 핵심 현황 — HTML 보고서](reports/v2-pre-poc-progress-2026-11-08.html) · 2026-11-08 / 설계 기준 `2c13f6d`. 확정 사항·설계 성과·비용 검토·남은 결정과 첫 로컬 PoC 범위를 요약한다. 단일 파일로 열 수 있고 인쇄/PDF 저장을 지원한다.

현재 실행 상태는 [25. 로컬 모형 첫 시험](25-local-model-first-run.md)과 [26. DB18 전환·왕복 복원 결과](26-db18-staging-results.md), [27. 영속 전송 대기](27-durable-queue-results.md), [28. 원자적 셀 이동](28-atomic-cell-move-results.md), [29. 영속 큐 통합](29-integrated-move-queue-results.md), [30. 요청1~3 체크포인트](30-local-checkpoint-results.md)를 따른다. 기존 문서의 미착수 표시는 작성 시점의 상태이며, 요청1~3의 로컬 기능 검증을 정리했으며, 대용량 최적화·제품/클라우드/실기 검증은 남아 있다.

실제 클라우드 준비의 최신 상태는 [31. Supabase 프로젝트·월 0원 검증 준비](31-cloud-readiness.md)를 따른다. 사용자 제공 프로젝트는 `hutqsfftioxtredcjhsy`, 초기 월 비용 상한은 **0원**이다. 게시된 환경의 실제 연결·인증과 도쿄 리전 정상 상태를 확인했다. [32. 읽기 전용 점검 결과](32-cloud-readonly-results.md)에 성공/403 응답과 다음 최소 적용 묶음을 정리했다. 조직 Free 플랜은 사용자 대시보드 확인 완료이며, 무료 잔여량은 미확인이다.

다음 단계의 로컬 PostgreSQL 최소 스키마·권한·원자성 시험은 **39개 성공**이다([33. 결과](33-local-postgres-results.md)). Auth는 시험 stub이며 실제 클라우드 쓰기/제품 통합은 미착수다.

인증·자산의 후속 로컬 시험은 [34. 결과](34-auth-private-assets-results.md)를 따른다. 가상 ES256 서명 검증28개와 PostgreSQL88개(기존39+신규49)가 통과했다. 실제 공개 JWKS 조회는 성공했으며, 실제 사용자 인증/Storage 쓰기는 아직 수행하지 않았다.

클라우드 적용 검토 묶음은 [35. 적용·복구안](35-cloud-application-review.md)에 정리했다. 준비 점검23개·서버 세션 어댑터11개·JWT28개·SQL127개가 통과했으며 실제 적용 준비 상태는 **BLOCKED**다. Usage·실제 gateway/Storage 등의 확인이 남아 있고 클라우드는 변경하지 않았다.

HTTP gateway와 고정 목적지 Storage REST 어댑터를 구현하고 실제 로컬 HTTP61개 시험을 통과했다([36. 결과](36-http-gateway-storage-results.md)). 메타데이터는 메모리 fixture이므로 실제 PostgreSQL 연계·Storage 검증/클라우드 적용은 남아 있다.

PostgreSQL 영속 metadata를 HTTP 흐름에 연결했고 통합25개·adapter12개·HTTP61개가 통과했다([37. 결과](37-durable-gateway-metadata-results.md)). 실제 SIGKILL/DB 재시작·lease 경합·늦은 I/O를 시험했으며, 미확정 요청의 자동 정리와 실제 Storage 검증은 남아 있다.

보수적 복구 worker·검토 후 실행·완료 기록을 추가했다([38. 결과](38-recovery-worker-results.md)). 복구 단위25개·metadata14개·HTTP61개·영속/복구41개가 통과했다. 정상 파일 복구와 확실한 정리는 지원하되, 미확정 요청이 남은 정리는 보류하며 실제 클라우드 적용은 하지 않았다.

전체 SQL/권한/중지·재개/빈 설치 제거 묶음을 생성하고 검증했다([39. 전체 검토안](39-full-bundle-review.md)). 단위29·기존준비23·SQL73개가 성공했고, 실제 read-only SQL로 Auth 구조/충돌 없음·DB17.11·Storage0개를 확인했다. DB-only 설치와 후속 cloud 검증을 분리했으며 두 준비 상태는 BLOCKED다. 실제 설치/파일 전송/환경 게시는 하지 않았다.

## 문서 지도

| 문서 | 논의 내용 |
|---|---|
| [59. PostgreSQL 이관 서버](59-postgres-migration-server.md) | serverRPC/RLS·manifest·readback/IO·publish/cancel 경쟁·ticketfence·전진SQL/빈rollback |
| [58. 이관 영속 상태·재개·취소](58-durable-migration-resume-cancel.md) | 별도journal·응답 유실/늦은 I/O·취소/게시 경쟁·SIGKILL·원본보호 |
| [57. 실행 격리·이관 완료 연결](57-runtime-isolation-and-migration-handoff.md) | 후보 runtime profile·기존 업데이트 피드 보호·원본 폴더 중첩 거절·서버 완료 계약 |
| [56. 로컬 영구 유지·온라인 사본 철칙](56-local-permanence-copy-migration.md) | 원본 불변·새 ID 복제·온라인 DB 이미지 본문0·독립 추출 PoC/실패 보호 |
| [55. Supabase private 파일 실검증](55-supabase-private-storage-live-results.md) | Free/Usage·파일3종·실제 gateway/복구·격리/동시quota·API 호환 수정·정리 |
| [54. Supabase Storage 확정](54-supabase-storage-decision.md) | 사용자 공급자 결정·DEV 읽기 점검·실제 플랜/Usage 확인·private 파일 검증 준비 |
| [53. Blob 선택안·예산·실전 시험 계획](53-blob-selection-and-verification-plan.md) | Free 과금/지역·용량/다운로드 계산·private 표본 검증 범위 |
| [52. 개발 Auth 실검증](52-development-auth-live-results.md) | 서버 키/RPC·실제 ES256 로그인·세션 회수·다른 사용자 공간 차단·시험 데이터 정리 |
| [다국어 상세 설계](01-localization.md) | 리소스·언어 선택·모든 배포 요소·사이징·언어별 배포 관문 |
| [데이터·동기화 상세 설계](02-sync-data.md) | DB 통합/분리, 3가지 방식, 오프라인 전환, 충돌·복원·파일/이미지 |
| [백엔드·인증·운영](03-backend.md) | 저장 장소, 계정/이메일 키, API·테넌트·백업·웹/모바일 공통화 |
| [단계·결정 기록](04-decisions-roadmap.md) | 확정/미확정 사항, 개발 전 관문·범위·비용 모델 |
| [온라인 저장·보호 구체안](05-online-policy.md) | 퍼블릭 클라우드 모델·리전/처리 경로·암호화 비교·백업 보관 추천 |
| [동기화 정책·연결 흐름](06-sync-policy-flows.md) | 공간/기기 정책 구분·전송 기본값·연결/중지/충돌/복원 흐름 |
| [인증·기기 연결 상세](07-auth-flows.md) | 이메일 OTP·세션 식별·추가 기기·회수·계정 복구 |
| [백엔드·비용 비교](08-backend-cost-comparison.md) | 저비용 후보 비교·확장 민감도·견적 확인표(16문서 우선) |
| [전환·충돌·복원 화면 흐름](09-migration-conflict-screens.md) | 원본 보존·초기 업로드·새 기기·충돌 비교·복원 영향 와이어프레임 |
| [다국어 키·용어집 계약](10-i18n-contract.md) | namespace·치환 타입·이전 순서·배포 검증, ko/en 예시와 용어집 |
| [플랫폼 지원 기능표](11-platform-matrix.md) | Desktop/Web/Mobile 1차 범위와 현재 활성249개 Feature ID별 검토표 |
| [MVP 범위 통합안](12-mvp-scope.md) | 확정/추천·필수/후속 범위·G0~G5·구현 전 결정 |
| [PoC 검증 명세](13-poc-spec.md) | fixture·장애22개·성능/비용 측정·증거·통과 기준(미실행) |
| [G0 설계 결정표](14-design-decision-pack.md) | 암호화·첫 플랫폼·백엔드 후보 선택과 나머지 미정 사항 |
| [PoC 작업 계획](15-poc-work-plan.md) | W01~W12·시나리오22개·환경별 증거 레지스터 |
| [저비용 원칙 전체 재검토](16-low-cost-review.md) | AWS 제외·무료/개인 요금 목표·소규모/동기화/백업/MVP 조정의 최신 기준 |
| [Neon 중심 대안 검토](17-neon-option.md) | Supabase 무료 프로젝트 소진 반영·DB/Auth/blob/API 분리·절전/합산 비용 검증 |
| [기존 프로젝트 실제 사례 분석](18-existing-project-analysis.md) | Neon/Blob/브랜치 운영·용량 절감·인증/공개 파일의 적용 경계 |
| [Supabase 환경 통합 검토](19-supabase-env-consolidation.md) | 브랜치 공식 과금 조건·로컬 개발 대체·슬롯 회수의 검증/전환 절차 |
| [Supabase 신규 계정·Keep Alive](20-supabase-keepalive.md) | 신규 계정 전제 갱신·Supabase 채택 시 하루1회 기본·휴면/복구 검증 |
| [Supabase 프로젝트 구성안](21-supabase-project-blueprint.md) | 운영1개/로컬 개발·공식 SMTP/리전 조건·설정/비용 관문 |
| [DB·권한·동기화 계약](22-db-permission-sync-contract.md) | 논리 테이블·tenant scope·원자적 push·커밋 순서 cursor·private 자산 |
| [개발 gateway·인증 연결](51-development-gateway-auth-wiring.md) | 개발 issuer/REST factory·로컬HTTP10개·공개 JWKS 확인·서버 service_role Secret 준비 |
| [개발 DB·KeepAlive 설치 결과](50-development-database-keepalive.md) | 기본 모듈 실제 권한 검증·건물수첩 pg_cron/정오 일일 작업·실행 probe 성공/제거·비용/정규 실행 추적 |
| [게시 후 개발 접속·권한 재검증](49-published-environment-validation.md) | DEV/PROD 적용 확인·개발GET200/서울·postgres 읽기쓰기 세션·선택기10검사·SQL 미설치 |
| [Blob 무료 용량·공급자 비교](48-blob-storage-provider-review.md) | R2/Supabase 공식 무료 한도·B2/Vercel 조사 대기·과금/아시아 조건·공급자 분리 |
| [현재 진행 항목·직접 설정 목록](47-active-work-items.md) | U01~U07 사용자 환경 설정·A01~A10 에이전트 작업·완료 기준/미완료 상태 |
| [로컬 무영향·이미지 저장 설계](46-local-compatibility-image-storage.md) | 앱/업데이트/DB 격리·온라인 binary 자산·workspace 중복 제거·가독성/용량 정책·누락 검토 |
| [개발·운영 환경변수 계약](45-environment-variable-contract.md) | DEV/PROD 접두어·명시적 환경 선택·공통 변수 전환·토큰/서버/마이그레이션 분리 |
| [개발 프로젝트 지정·접근 설정](44-development-project-access.md) | vsphftnmfzfoufasjttd 지정·현 토큰GET403·개발 ref/토큰/호스트 변경값·재개 순서 |
| [개발·운영 DB 분리/권한 설정 절차](43-dev-prod-database-setup.md) | 별도 Free 프로젝트 추천·관리/PAT/DDL/server/client 권한 분리·환경 입력·개발 우선 적용 순서 |
| [실제 SQL 설치 시도·연결 차단](42-cloud-sql-install-attempt.md) | 사용자 승인 후 요청1회·읽기 전용 오류·생성 객체0개·쓰기 연결 준비 후 재개 |
| [SQL 최종 기술 검토·적용 절차](41-sql-final-review-runbook.md) | 실제 BYPASSRLS 서비스 역할·SQL87개·검토 해시·설치/timeout/복구 절차·용량 미확인 |
| [SQL 실행 역할·권한 검토](40-sql-executor-review.md) | 실제 postgres 속성·Auth RLS·비 superuser 로컬86개·쓰기 권한/설치 승인과의 경계 |
| [전체 SQL/권한/되돌리기 묶음](39-full-bundle-review.md) | 단일 transaction·source/hash·ACL·자료 보존 pause·empty-only uninstall·실제 읽기 점검 |
| [보수적 복구 worker·검토 계약](38-recovery-worker-results.md) | bounded 미리보기·검토 hash·재검사·새 기기 복구·audit/replay·미확정 보류 |
| [영속 metadata·gateway 재시작](37-durable-gateway-metadata-results.md) | 실제 SQL·두 gateway·SIGKILL/DB 재시작·lease/fence·불명확한 I/O 보수적 보존 |
| [HTTP gateway·Storage 계약 구현](36-http-gateway-storage-results.md) | 실제 loopback HTTP61개·인증/전송/재시도/정리 실패·영속 metadata 미연계 |
| [클라우드 적용·복구 검토안](35-cloud-application-review.md) | 고정 대상·C1 SQL/rollback·서버 세션 어댑터·준비 검사·C2 저장소 계약 |
| [인증·기기 회수·비공개 자산](34-auth-private-assets-results.md) | 공개 JWKS 확인·가상 서명28개·SQL88개·실제 Auth/Storage와의 경계 |
| [로컬 PostgreSQL 최소 서버 시험](33-local-postgres-results.md) | 실험용 SQL·계정 RLS/명령/rollback/동시성39개 성공·실제 Auth와의 경계 |
| [실제 Supabase 점검 결과](32-cloud-readonly-results.md) | 접속 성공·도쿄 정상·조직 조회403·SMTP/Storage 실측·최소 서버 적용 순서 |
| [무료 운영 조건·PoC 준비 판정](23-supabase-free-tier-readiness.md) | 공식 고정 소스의 무료 한도·아시아·SMTP, 용량/교체 피크·백업 분할·남은 계정 확인 |
| [권장 구성·로컬 PoC 검토안](24-local-poc-review-package.md) | 복구 제한·상태/명령 계약·장애8개, 24.9~24.10 첫 구현 묶음·시험 자료·증거/완료 기준 |
| [번역 후보 CSV](i18n-inventory.csv) / [집계 JSON](inventory-summary.json) | 현재 소스의 번역 후보 조사. 번역 완료/정제된 키 목록이 아님 |

**현재 검증 대상:** 사용자 제공 Supabase 프로젝트 `hutqsfftioxtredcjhsy`. 초기 월 상한은 **0원**이며, Keep Alive 기본 요구를 유지한다([20문서](20-supabase-keepalive.md)). 도쿄 리전·기본 SMTP 설정은 실제 조회했고, 조직 플랜 API는 403이지만 Free 여부는 사용자가 확인했다. 계정별 한도·잔여량은 미확인이다([32문서](32-cloud-readonly-results.md)).

**최신 운영 원칙:** AWS 직접 구성/운영은 제외하고 무료 또는 개인 요금제 수준을 목표로 한다. [16문서](16-low-cost-review.md)가 기존 상시 실시간·백업 보관·PITR/규모 추천에 우선한다. [23문서](23-supabase-free-tier-readiness.md)에서 공식 공개 소스의 무료 한도·아시아 리전 목록·메일 제한을 확인했다. 실제 신규 계정의 플랜/잔여량·리전 선택·총비용은 미확인이다.

## 우선 추천

1. **한 제품·공통 도메인 + 명확한 배포 프로필.** 기존 완전 로컬판을 유지하면서, 온라인 기능은 명시적으로 가입/연결한 공간에만 제공한다. 웹/모바일은 같은 도메인과 프로토콜을 쓰고 UI·플랫폼 어댑터는 각 환경에 맞춘다.
2. **언어와 지역·달력을 분리.** 1차 지원 언어는 사용자 확정에 따라 한국어·영어다. 추가 언어는 같은 계약으로 확장한다. 업무 데이터는 번역하지 않는다. 앱/사이트/매뉴얼/내보내기/설치 안내까지 같은 언어 릴리스 단위로 관리한다.
3. **DB는 개념을 통합하고 실행 저장소는 분리.** V2 로컬 SQLite와 서버 PostgreSQL을 같은 도메인 계약으로 연결한다. 기존 V1 DB는 복사·검증으로 전환하며 두 앱이 같은 파일을 번갈아 쓰지 않는다.
4. **최종 방향은 로컬 우선 변경분 동기화.** 실시간·주기 방식은 같은 outbox/cursor 프로토콜의 전송 시점 차이로 설계한다. 온라인 백업은 별도 기능이며 변경분 동기화와 혼동하지 않는다.
5. **계정이 소유권, 이메일 인증은 가입/기기 연결 수단.** 만료 없는 이메일 키를 데이터 접근 권한으로 사용하지 않는다.
6. **백엔드 초안: 관리형 Auth + PostgreSQL + 비공개 객체 저장소 + 자체 Sync API.** 사업자·리전·요금제는 미선정. 파일 공유 폴더의 실행 중 SQLite를 여러 기기에서 덮어쓰는 구조는 채택하지 않는다.

## 현재 앱에서 확인한 전제

- Tauri Windows/macOS + React/TypeScript, 브라우저 개발 모드, 공간별 SQLite 파일1개.
- `src/data/repository.ts`가 쓰기 경계이며 `SqlDriver.batch` 사용. Cabi.NET은 문서 revision과 자식 창 RPC/flush 경계를 이미 갖고 있다.
- UUIDv7 식별자가 있으나 모든 테이블이 전역 UUID 기반인 것은 아니다. 예: `week_note.week_id`는 주차 문자열이 PK이므로 서버에서 workspace 범위가 반드시 필요하다.
- 노트/보드 본문은 JSON이며 기존 Cabi.NET revision은 **로컬 동시 수정 방지용**이다. 네트워크 동기화 revision으로 그대로 재사용할 수 없다.
- 이미지 원본은 DB의 base64이며, 자료함 폴더/바로가기는 장치 경로를 가리킨다. 온라인 전환 시 텍스트 레코드만 복사해서는 기존 기능이 완성되지 않는다.
- 기존 제품은 외부 통신0 원칙이다. 온라인 설계 검토를 허용한 이번 요청은 실제 전송 허가가 아니다. 후속 구현 전에 온라인 프로필의 명시적 통신 범위·사용자 연결 절차를 확정한다.

## 확정 범위와 남은 결정

- **사용자 확정(2026-11-08): 1차 언어는 한국어·영어, 온라인 기능은 개인의 여러 기기 간 동기화 우선.**
- 1차에는 팀 초대·타인과 공간 공유·공동 편집을 포함하지 않는다. 팀 협업은 후속 확장이며, 미래 권한 구조와 충돌 처리 경계는 유지한다.
- 같은 사람이 두 기기에서 오프라인으로 수정하는 경우도 충돌할 수 있으므로 revision·양쪽 사본 보존·재조정 설계는 1차 필수다.
- **추가 사용자 확정(2026-11-08): 개인용/외부 서비스용 퍼블릭 클라우드 저장 가능 모델이 필요하다.** 회사 정책 확인을 전체 서비스 설계의 선행 조건으로 두지 않는다.
- **추가 사용자 확정(2026-11-08): 소규모로 시작하고 초기 리전은 아시아 범위로 한정한다.** 아시아 내 단일 primary region을 기준으로 상세 설계하며 국가/도시·사업자는 후보 검토 후 결정한다.
- **추가 사용자 확정(2026-11-08): 1차 온라인 저장은 TLS+서버 저장 암호화로 시작하며, 첫 출시는 Windows·macOS를 우선한다.** 서버는 허가된 처리에서 본문에 접근할 수 있다. E2EE는 1차에 포함하지 않고 Web/Mobile은 후속 확장으로 둔다.
- 사업자·정확한 리전/사용자 수·이미지 용량·계정 복구안은 미확정이다. 초기 운영 예산은 월 0원으로 확정했다. 실제 암호화 설정 검증·PoC 구현/클라우드 생성은 별도이며, 실제 회사 자료의 업로드 허가는 개인 서비스 모델 채택과 별개다.

검토 순서는 **언어/협업 범위 → 동기화 방식·보관 장소/인증 → 마이그레이션·충돌 UX → 백엔드/플랫폼 단계**를 권장한다. 아래 문서의 API·필드·수치는 구현 계약의 초안이며 확정된 서비스 제공 약속이 아니다.
