# V2 설계·PoC 중단/재개 기록

**현재 재개 정본:** [74. 진행 현황 분석(2026-11-13, main 1.40.0/DB20 동기화)](74-progress-analysis-1113.md) → [73. Connected Preview native 격리](73-connected-preview-native-isolation.md). 다음 추천은 DB20(칸반) 사본 계약부터. 이하 체크포인트는 작성 당시 기록이며 가장 최근 결과가 우선한다.

2026-11-09 UTC · V2 설계/PoC 중단 지점을 보존한 뒤 복귀했다. 사용자 요청으로 main 1.23.1 패치(`d11a0ca`)를 v2-design에 병합했다.

## 보존 위치

- 작업 브랜치: **v2-design**. main에 병합하지 않는다.
- 마지막 기술 검토 커밋: `3f431e1` (이 기록 직전). 이 문서를 포함한 후속 보존 커밋이 재개 출발점이다.
- 설계 목차: [README](README.md), 결정 이력: [04](04-decisions-roadmap.md).
- 최신 상세 결과: [39 SQL 묶음](39-full-bundle-review.md), [40 실행 역할](40-sql-executor-review.md), [41 최종 검토·실제 적용 절차](41-sql-final-review-runbook.md).
- 실제/로컬 증거: `docs/v2-design/evidence/`; 최신 판정 `sql-final-readiness.json`, 검토 `sql-final-technical-review.json`.

## 확정 방향

한국어/영어, 개인 여러 기기 동기화 우선, Windows/macOS 먼저. 로컬 우선 변경분 동기화와 온라인 백업을 구분한다. TLS+서버 저장 암호화로 시작하며 팀·웹·모바일은 후속이다. AWS 직접 운영은 제외하고 초기 **월0원**, 아시아 단일 리전, Supabase Free를 기준으로 한다. Keep Alive는 기본 요구지만 아직 실제 설치하지 않았다.

대상 프로젝트는 `hutqsfftioxtredcjhsy` / 도쿄 `ap-northeast-1`. 사용자가 Free 플랜을 확인했다. 관리 토큰/변수는 환경 설정으로 제공되며 비밀값을 문서/채팅에 넣지 않는다. 재개 시 환경 readiness를 다시 확인한다.

## 완료 범위와 한계

언어 리소스/배포·플랫폼 기능표·인증/동기화/전환/충돌/복구/비용 설계와 독립 PoC를 보존했다. 로컬 SQLite214개, JWT29개, HTTP61개, 영속/복구 통합41개 등은 각 단계 문서의 **서로 다른 범위·실행 시점** 결과다. 합산하여 제품 완성도나 실제 클라우드 검증으로 해석하지 않는다.

최신 SQL은 원자적 install, 권한 확인, 자료 보존 pause/resume, empty-only rollback 묶음이다. 마지막 실행은 SQL87개(기본39+묶음34+역할14), bundle29개·기존 readiness23개 통과. 실제와 같은 BYPASSRLS service_role도 관리 table6개 직접 조회가 거절된다. manifest SHA-256은 `6ace6c937126d792660580a7f253e11db631b8ed56ffe9d9f1e43fdcdfa946ad`다. 재개 시 실제 bytes와 다시 대조한다.

실제 Supabase는 **공식 read-only SQL endpoint의 SELECT와 GET만** 사용했다. Auth6컬럼·역할/권한·RLS·이름 충돌 없음·private schema 미노출 등을 확인했다. 클라우드 DDL/DML, bucket/Auth 사용자/seed 생성, 업무 자료 업로드, gateway 배포, Keep Alive/SMTP 변경, 제품 앱 통합은 하지 않았다. 앱1.23.0/DB18은 이 분기에서 유지했으며 main 긴급 패치는 별도로 진행한다.

## 최신 설치 준비 상태

사용자가 Usage 사용량을 **0.026GB**로 제공했다(2026-11-09 UTC, 정확한 기록 시각은 관측 JSON 참조). 기존 사용자 Free 확인과 공식 공개 Free 기본 한도500MB를 적용하면 사용 약26MB/추정 잔여474MB다. 이 값은 표시값에서 계산한 추정치이며 계정별 한도를 API로 독립 확인한 결과가 아니다. 출처·단위·공개 한도 근거는 `observations.current.json`의 databaseUsageEvidence에 보존한다. 기존 물리 DB/파일시스템 여유로 계산한 값이 아니다.

사용자가 DB-only 실제 설치를 승인했고, 정확한 install.sql로 한 번 요청했다. 하지만 현재 API 연결이 supabase_read_only_user / transaction_read_only=on으로 실행되어 SQLSTATE25006을 반환했다. 후속 verify는 schema0/table0/function0이다. **실제 설치되지 않았고 현재 준비 상태는 BLOCKED / SQL_EXECUTOR_READ_ONLY**다. 기존 REVIEW_READY 결과는 쓰기 연결 시험 전의 기록으로 보존한다.

승인 범위는 유지되며 재승인은 필요하지 않다. 실제 SQL 쓰기가 가능한 연결 설정 또는 소유자의 SQL Editor 실행이 필요하다. 토큰 scope/역할/연동 중 정확한 제한 원인은 단정하지 않는다. [42 설치 시도·재개 방법](42-cloud-sql-install-attempt.md)의 증거를 먼저 읽고, 연결 변경/수동 실행 이후 **읽기 verify부터** 진행한다. 이미 설치됐다면 중복 설치하지 않는다. Storage/Egress/gateway/private Storage 실제 검증은 별도로 남아 있다.

## 개발 우선 구성 요청(최신)

사용자가 본격 개발을 위해 개발 DB를 운영 예정 DB와 분리하고 읽기 전용 연결/권한 재구성 절차를 요청했다. [43문서](43-dev-prod-database-setup.md)의 **별도 Free 프로젝트 운영1+개발1**을 추천했다. 사용자가 개발 URL을 제공해 dev ref는 vsphftnmfzfoufasjttd로 지정했다. 운영 예정 ref는 hutqsfftioxtredcjhsy로 분리한다. 현재 토큰은 dev 프로젝트GET403이며 환경 ref/개발 호스트 설정도 미반영이다. [44문서](44-development-project-access.md)에 정확한 변경값과 접근 증거를 기록했다. 관리형 branch는 무료로 간주하지 않는다. 현재 SQL 설치를 기존 대상에 재시도하지 않고, 개발 식별자/연결 확정→dev 전용 묶음 재검토→권한/설치 검증 순으로 진행한다. 기존 대상 고정 manifest를 그대로 dev로 실행하지 않는다. 프로젝트/토큰/권한 변경은 아직 수행하지 않았다.

## 환경변수 분리(최신 안내)

사용자 요청으로 [45문서](45-environment-variable-contract.md)에 WJB_CLOUD_ENV=development와 DEV/PROD_PROJECT_REF·MANAGEMENT_TOKEN 분리 계약을 작성했다. 기존 공통 변수 교체 안내에 우선하며, 새 이름은 아직 실제 환경에 적용/연결하지 않았다. 새 개발 토큰의 접근 검증과 개발 bundle/실행 경계 구성은 남아 있다. 현재 변수/비밀을 자동 변경하거나 제거하지 않았다.

## 최신 진행 목록·로컬/이미지 설계

[47문서](47-active-work-items.md)가 현재 사용자 직접 설정(U01~U07)과 에이전트 작업(A01~A10)의 정본이다. 운영 ref만 초안 revision2에 pending이고 Secret 이름 변경/실제 실행 환경 전환은 미완료다. 기존 순서보다 **DEV 변수/쓰기 접근 구성→개발용 bundle 분리**를 먼저 진행한다.

[46문서](46-local-compatibility-image-storage.md)에 기존 로컬 모델 무영향 점검을 보완했다. V2 별도 앱/설정/업데이트 피드, V1 사본 전환, 로컬-only 무계정, 온라인 공간의 DB 밖 이미지·완전 오프라인 자산/패키지 백업을 구분한다. 실제 PoC는 hash dedup이 없고64KiB 제한이다. 새 workspace별 immutable blob 공유/논리 참조·COW/GC/해상도·품질 수치는 설계 제안이며 아직 구현/성능 실증하지 않았다. 기존 V1 DB/base64/1600px 처리 코드는 유지한다.

## Blob 공급자 검토 추가

[48문서](48-blob-storage-provider-review.md)에 온라인 private Blob 공급자 비교를 추가했다. R2 Standard 공식10GB-month·A100만/B1,000만·인터넷egress 무료를 확인했지만 초과 과금/checkout·아시아 위치 힌트 보장 한계를 함께 기록했다. Supabase Free Storage1GB는 비교 기준이며 B2/Vercel 현행 조건은 추가 확인이 남았다. 공급자를 선택/가입/활성화하지 않았다. 47문서 A11에서 계속 관리한다.

## 재개 순서

1. **완료:** main 1.23.1 업무 메모보드 바로가기 패치(`d11a0ca`)를 v2-design에 충돌 없이 병합했다. 앱 기준은1.23.1/DB18이다. V2 설계/PoC를 main에 병합하지 않았고 클라우드 적용도 수행하지 않았다. 다음 재개는2번부터 진행한다.
2. 이 문서→41문서→검토/관측 JSON을 읽고 환경 readiness, 대상 ref, Free/월0원 조건을 확인한다. 오래된24시간 관측은 재조회하고 기술 검토 hash와 현재 SQL을 대조한다.
3. **진행:** 사용자 Usage 0.026GB와 공개 Free500MB 기준을 출처와 함께 기록했다. 실제 적용 직전 한도/플랜 변경 여부와 관측 신선도를 재확인한다. 소스가 바뀌면 해당 검토/시험을 다시 수행한다.
4. **승인 완료·연결 차단:** 42문서에 따라 SQL 쓰기가 가능한 연결을 준비한 뒤 현재 객체 상태를 읽기 조회하고 41문서 순서로 재개한다. 같은 범위 재승인은 요청하지 않는다. `bundle/*.sql` 일괄 실행 금지. timeout/응답 유실 시 읽기 조회로 commit 여부부터 확인한다.
5. 설치 후 verify/소유자/ACL을 확인하고 증거를 보존한다. gateway/Storage 성공 flag는 별도 실제 검증 전까지 false 유지한다.
6. 후속 전용 private bucket·가상 사용자/공간·gateway·표본 파일 검증, 메일/Keep Alive, 실제 앱 연결·다국어 이행을 단계별로 진행한다. 각 단계 비용/통신 범위를 다시 확인한다.

이 중단 기록은 V2의 추가 구현/배포를 요청하는 문서가 아니다. 사용자가 재개를 요청할 때 이어서 진행한다.

## main 작업 전 체크포인트(2026-11-09)

Blob 후보 비교까지899c56e에 보존했다. 현재 환경은 기존 공통 변수이며 PROD ref만 초안 revision2 pending, 비밀 이름 변경/DEV 토큰·호스트·저장/게시가 사용자 대기다. DEV GET403, SQL 미설치 상태는 유지한다. 47문서 U01~U07/A01~A11을 재개 기준으로 삼는다. 사용자 요청으로 main에서 캐비넷 정렬·표 열 크기/행열 이동·메뉴 동작 수정 후 v2-design으로 복귀한다. 이 main 수정은 V2 cloud/설계 변경을 포함하지 않는다.

## main 수정 완료·V2 복귀(2026-11-09)

main에6250ecd(1.23.2)로 캐비넷 노트/자료 목록 정렬·표 열 너비·행열 손잡이 이동·바깥 클릭 닫기·블록 메뉴 내부 스크롤 유지 패치를 반영/푸시했다. 단위525개·선택 회귀11개, 최종 신규 시나리오3개 재검증과 빌드/품질/가이드/Feature List 검사가 통과했다. main CI/Windows·macOS 빌드는 Actions 결과를 별도로 확인한다. main 패치를 v2-design에 병합해 복귀했으며 V2 환경 설정 대기·개발403·SQL 미설치 상태는 변경하지 않았다. 다음 작업은47문서의 사용자 환경 설정 및 개발 연결 구성이다.

## main CI 수정1.23.3 후 복귀

main CI42585959844의 실제 실패는 Chromium 표 이동 undo 시 표 전체가 함께 취소된 현상이었고 WebKit도 같은 위치에서 재시도됐다. main bb60b10(1.23.3)에서 이동 전후 history 경계를 분리하고 빠른 연속 동작 단위 검사를 추가했다. 단위527개·실패 시나리오3회 연속 검증·빌드/품질 검사가 통과했다. main 원격 CI 결과는 별도 확인하며 성공을 선행 기록하지 않는다. 패치를 v2-design에 병합했고 환경 설정/개발 접근 대기 항목은 그대로다.

## 환경 게시 후 재개(최신)

사용자가 저장/게시를 완료했고 [49문서](49-published-environment-validation.md)에 신규 런타임/변수·Secret/호스트 적용과 실제 DEV GET200·서울·postgres read_write 세션 확인을 기록했다. 403/readonly 관련 이전 기록은 과거 상태다. 신규 env 선택기10개 검사를 통과했으나 기존 bundle/issuer/gateway는 운영 예정 ref에 고정돼 있다. 개발 Free/Usage/생성 권한 및 dev 전용 bundle 구성이 다음 단계다. DDL/운영 접속·환경 변경/재게시를 하지 않았다. U01~U06 최신 상태는47문서 추가 절을 따른다.

## 개발 DB·KeepAlive 실제 적용(최신)

사용자 요청으로 [50문서](50-development-database-keepalive.md)의 dev 전용 bundle을 적용했다. schema2/table6/function7 권한 검증과 추가 public.keepalive_pings1행/pg_cron1.6.4/keepalive_ping 매일12:00 KST를 확인했다. 동일 command5초 probe는 succeeded/시각 갱신 후 unschedule했고 정규 job1개만 남았다. 실제 일일 job 첫 실행 관측과 개발 Free/Usage(조직API403), gateway/Auth/private 자산은 미완료다. install.sql 재실행 금지. 기존 운영 예정 bundle/프로젝트·로컬 앱·환경 설정/게시 변경은 없다. 다음은50문서 남은 조건과47문서 최신 추가 절을 따른다.

## 개발 gateway/Auth 연결 구성(최신)

[51문서](51-development-gateway-auth-wiring.md)에 dev factory·issuer/REST 연결과 신규HTTP10/기존gateway61/metadata14/recovery25/Auth28+11 검증을 기록했다. 공개 DEV JWKS는 ES256이다. DEV_SERVICE_ROLE_KEY가 없어 실제 Auth/RPC/Storage 전체 검증은 아직이며 새 Secret 요구만 초안 저장했다. 사용자가 개발 legacy service_role을 설정/적용·게시하면 확인 후 실제 서버 RPC/인증 검증을 진행한다. Blob 공급자/버킷은 미선정·미생성이고 운영/KeepAlive/앱/main은 변경하지 않았다.

## 실제 개발 인증 검증 완료(2026-11-10 KST, 최신)

[52문서](52-development-auth-live-results.md)의 서버 RPC/실제 로그인·서명/세션 회수/계정 간 공간 격리20검사와 시험 데이터 정리 확인이 통과했다. HTTP 시크릿 ready 및 U08 완료, 키 재입력/게시 요구 없음. 임시 Auth 계정2개는 삭제 후404, metadata/차단 행은 잔여0이다. 비밀/토큰은 보존하지 않았다. Blob 공급자·버킷·파일 전송·공개 gateway는 미완료이며 다음은 private Blob 비교/선택안 확정이다. U07 개발 Free/Usage 및 V1/V2 배포/저장 경계는 계속 남는다. install.sql 재실행 금지, main/로컬 앱 변경 없음.

## Blob 선택안 정리(2026-11-10 KST, 최신)

[53문서](53-blob-selection-and-verification-plan.md)의 무료/지역/전송 비용 검토와 계획 예산을 정리했다. Supabase Free 과금 없음·R2 초과 과금/아시아 보장 미확인·Workers Free10ms 조건을 구분했다. 초기 Supabase private Storage안을 제안했으나 공급자는 미선정이며 아시아 힌트 허용 여부 답변/U07 Free·Usage 확인이 남는다. 다음은 답변을 반영한 공급자 확정→DEV private 가상 표본 전송/정리 검증이다. 52문서 Auth20검사/cleanup 완료 상태를 유지하며 환경/계정/구독/버킷/실제 파일/제품/main은 변경하지 않았다.

## Supabase Storage 확정(2026-11-10 KST, 최신)

사용자가 초기 Blob 공급자를 Supabase로 확정했다. [54문서](54-supabase-storage-decision.md)가 최신 결정이다. 월0원은 유지하고 Pro 업그레이드는 승인받은 것으로 해석하지 않는다. 개발 Storage 읽기 API200/bucket0/object0/RLS true를 확인했으나 개발 조직 플랜/청구 Usage(U07)는 대시보드 확인이 남아 있다. 다음은 U07→DEV private 제한 표본 gateway 전송/조회/삭제·격리/회수·cleanup 시험이다. R2 관련 질문/가입은 진행 선행 조건에서 제외했다. 현재 실제 파일/버킷/정책 생성·환경/제품/main 변경은 없다.

## 개발 private Storage 실검증 완료(2026-11-10 KST, 최신)

[55문서](55-supabase-private-storage-live-results.md)가 최신 체크포인트다. 사용자 DEV Free/Storage/Egress 화면으로U07 완료. 실제 private bytes3종/loopback gateway47검사+정리4개 및 관련 로컬156개가 통과했다. 첫 취소 실패는 Supabase HTTP400/내부404 Object not found 호환 수정으로 해결했고 증거를 분리했다. 생성한 계정/실물/버킷/시험metadata는 모두 제거했다. 다음은A06 V1/V2 앱/설정/업데이트/원본복사 격리→A07/A08 자산/dedup·품질 PoC다. 현재64KiB·assetId 계약을 제품용 dedup 완료로 해석하지 않는다. 실제 제품/기기/공개 gateway/이메일은 미완료다. install.sql 재실행·운영/로컬/유료/환경 변경 금지 범위는 유지한다.

## 사용자 철칙·metadata-only 사본 PoC(2026-11-10 KST, 최신)

[56문서](56-local-permanence-copy-migration.md)와 CLAUDE.md가 최상위 계약이다. 로컬 모델은 사용자가 명시적으로 포기하기 전 영구 지원. 마이그레이션은 원본 DB/이미지 그대로 유지한 별도 ID/위치 온라인 사본 생성. ‘중복’은 온라인 DB/Blob의 이미지 본문 이중 저장 금지이며 로컬 원본/오프라인 실물 보관은 허용한다. 예전 db18 staging/local_assets BLOB는 역사적 시험으로만 유지. 신규connected-copy22개/기존DB18회귀19개 통과했고 실제 Supabase 이관/앱 연결은 미구현이다. 다음은 설정/배포 격리와 추출→서버 참조/Blob 업로드→전체 검증/활성화·재개/취소 연결이다. 이미지 재압축은 신규 온라인 사본의 선택 정책으로만 후속 검토한다.

## 실행 격리·이관 완료 연결 PoC(2026-11-10 KST, 최신)

[57문서](57-runtime-isolation-and-migration-handoff.md)를 최신 재개점으로 읽는다. local/connected 후보 namespace·기존피드 온라인RC 게시거절·로컬 cloud 초기화0·온라인실패 원본fallback 거절·서버 완료 정보 callback·원본폴더 중첩 경로 가드를 검증했다. 격리29/사본23/DB18회귀19=71개 통과. 원본55/56 철칙과 실제Storage 검증은 유지한다. 실제 native 앱/배포·서버 이관 완료RPC는 아직 없고 다음은 이관작업/manifest 영속 상태→서버 매핑/Blob전송/재개·취소→검증/완료증표 구현이다. 제품/설정/Cloud/원본자료/기존 릴리스는 변경하지 않았다.

## 영속 이관 journal/재개·취소 PoC(2026-11-10 KST, 최신)

[58문서](58-durable-migration-resume-cancel.md)가 최신 재개점이다. 신규32개/회귀71개=103개 통과. journal은 source와 겹치지 않는 별도DB이며 ID/hash/정수크기/상태만 저장한다. 업로드/게시/삭제 응답 유실·cancel fence·이미게시취소거절·SIGKILL/lease·파일유실 후 정리를 테스트용remote와 검증했다. 실제Cloud 이관RPC/메타데이터mapper/native 앱 연결은 아직 없다. 다음은 PostgreSQL의 이관 테이블/원자적 publish-cancel·관측/완료증표 RPC→로컬PG검증→신규전진SQL/ACL/rollback검토→DEV통합이다. 기존install재실행 금지, source 원본/로컬모델영구유지/이미지본문 DB0 철칙 유지. 이번 실제 사용자/Cloud/제품/환경 변경 없음.

## PostgreSQL 이관 서버 모듈(2026-11-10 KST, 최신)

[59문서](59-postgres-migration-server.md)가 최신 재개점이다. 로컬PG17.11/NOSUPERUSER-BYPASSRLS 소유자로 서버39개 통과. wjb_migration job/asset/document·RLS·serverRPC·gatewayINSERTgate,readback/IO검증·publish ticket/fence·원자적취소/관측·빈rollback을 구현했다. 최소문서프로필migration-document-poc-1/receipt poc-verified는 제품활성화금지(실행가드실험거절). reviewmanifest는DEV/autoApply=false이며Cloud에적용하지않았다. 다음은전체DB18문서/논리자산mapper와source/targetmanifest별도바인딩·journal/실제gatewayadapter연결이다. 이후신규전진SQL검토/DEV통합. 기존install재실행/원본변경/로컬모델폐기 금지 철칙 유지.

## 전체 DB18 매핑·RPC 연결(최신)

[60문서](60-db18-workspace-map-gateway.md)에26개 테이블 매핑17개·HTTP16개·실제PG40개 검증을 기록했다. 원본/온라인 manifest 해시를 구분하며 전체 봉투를 최소문서 RPC에 보내는 것은 거절한다. 다음은 전체 서버 프로필/저장 검증과 journal 이중 해시 영속 연결, 실제 Storage readback/취소 어댑터다. 신규 SQL은 DEV 미적용이며 제품/원본/환경/과금 변경은 없다.

## main 동기화 전 보존(2026-11-10 UTC)

현재 작업 정본은60문서와194c172이다. DB18 전체26테이블 메타데이터 매핑·서버 RPC 신뢰 경계·source/target 해시 분리를 구현했고 JavaScript136개/실제PG40개 총176개 검증을 보존했다. 전체 봉투 서버 저장, journal 이중 해시 영속 바인딩, 실제 Storage readback/취소 연결은 남아 있다. 로컬 영구 유지·새 사본 이관·온라인 DB 이미지 본문 금지 철칙 유지. 현재 신규 SQL은 Cloud 미적용이다.

사용자 요청으로 origin/main ae97c10(1.24.1/DB19)의12개 커밋을 v2-design에 병합한다. 병합 전까지 PoC는1.23.3/DB18을 기준으로 검증했다. main의 DB19 삭제 잠금 필드는 향후 이관 계약에 반영해야 하며 기존 DB18 계약을 변경 없이 DB19 지원으로 해석하면 안 된다. main에는 V2를 반영하지 않는다.

## main 1.24.1/DB19 반영(최신)

[61문서](61-main-1.24.1-sync-checkpoint.md)에 main ae97c10까지12개 커밋과 V2 작업의 병합을 기록했다. 앱532개/V2회귀136개·빌드·문서 정합성이 통과했다. 기존 이관 PoC는DB18만 지원하며 DB19를 원본 변경 없이 거절하는 것을 확인했다. 다음은DB19 삭제 잠금 보존/복원과 버전별 사본 계약 검증을 먼저 진행한 뒤 전체 서버 프로필/journal/Storage 연결로 돌아온다. main/실제Cloud/원본은 변경하지 않았다.

## DB19 이관 호환성 보완 완료(최신)

[62문서](62-db19-copy-contract-compatibility.md)에 요청1번을 반영했다. DB18 전용API는 유지하며 DB19 스키마/잠금 값/원본 보호를 명시적으로 검증한다. 새 온라인 사본의 본문 없는DB·분리이미지를 유지하고 합성 표본을 새 로컬DB로 복원해 전체 행/이미지/잠금·본문revision 규칙을 확인한다. 다음은2번 전체 봉투 서버 프로필/전진SQL 확장이며 제품/Cloud연결은 아직 아니다.

## 전체 워크스페이스 서버 프로필(최신)

[63문서](63-full-workspace-server-profile.md)에 요청2번 서버 저장/검증을 구현했다. 새004/읽기005/미사용006rollback과 별도 review manifest를 추가했고 기존001/제품 코드는 유지한다. DB18/19 전체26테이블 봉투를 검증·저장하고 게시 전 재구성 해시를 대조한다. 실제 Cloud 미적용이며 현재 gateway JS는 최소문서만 지원한다. 다음은3번 전체 프로필/journal의 source-target 해시 영속 연결, 이후 실제Storage/DEV 검토다.

## 전체 프로필 gateway·journal 연결(최신)

앞 단계1/2를 f1477af로 커밋·푸시했다. [64문서](64-workspace-gateway-journal-binding.md)에 전체 RPC opt-in·journal version2의 보존 업그레이드·source/mapping/target 해시 영속 바인딩·실제 서버 제어 재개/취소를 구현했다. PoC 완료는 제품 connected로 승격하지 않는다. 이미지 공간은 metadata 저장/검증 후 차단하며4번 실제 Storage 연결이 남아 있다. start 유실 후 binding/사본이 모두 없으면 보수적으로 중단한다. 실제 Cloud/제품/원본은 변경하지 않았다.

## Storage 이미지 I/O 연결(최신)

[65문서](65-workspace-storage-io.md)에4번을 구현했다. 기존 private REST/C2와 전체 session을 연결하고 journal version3 IO receipt를 추가했다. terminal 응답 확인→정산→bytes readback/attest→게시, cancel fence→미정산 대기→삭제/부재 확인→quota 반환을 구현한다. POST 자체가 불명확하면 자동 해제하지 않는다. 실제 로컬PG/Storage HTTP 표본을 쓰며 Cloud 미적용이다. 다음은5번 DEV 신규 전진SQL 설치상태/hash/ACL 검토 후 실제 Supabase 이관 표본 검증이다. 기존 설치/KeepAlive 재실행 금지, 제품/로컬원본은 유지한다.

## DEV 실제 이관 검증 완료(최신)

Storage작업은3215cdb에 보존했다. [66문서](66-development-migration-live-results.md)에 DEV 신규001/004 실제 적용·5테이블RLS·Auth/Storage 기능44개/정리4개 통과를 기록했다. 세 가상 공간/두 계정/Blob3개204bytes를 시험하고 잔여0을 확인했다. C1/C2 함수6개와 cron설정 불변, KeepAlive정규 실행2026-11-10 03:00UTC succeeded 확인. 새 모듈은 DEV에 유지하므로 재설치 금지. 현재변수로실행/설정추가없음. 다음은6번 제품 실행/설정/업데이트 격리·연결UI 검토이며 아직native제품기능은 아니다.

## 6번 상세 설계·UI 검토안(최신)

cfdeae4가 원격과 일치해 재푸시만 확인하고 [67문서](67-product-isolation-connection-ui.md)를 작성했다. A설정확장/B공간허브/C측면패널3안과20개 상태·3개테마·이미지/HTML을 제공한다. 추천은A이며 별도ConnectedPreview와Classic의 관계도 검토 대상이다. 180개 조합렌더링·명시동의·배경blur/차단·키보드/중단/취소·C430px·외부요청0을 검증한다. 실제제품/Cloud미변경. 다음은사용자시안선택→6-B native프로필/설정/업데이트격리부터구현범위확정이며7번sync/8번i18n은후속이다.

## 사용자 피드백: 기존 공간 유지·신규 온라인 운영(최신)

[68문서](68-workspace-type-operating-rules.md)가67의 용어/운영 설명에 우선한다. 기존 워크스페이스는 오프라인 전용으로 이름/식별/DB/이미지/백업 그대로 유지하며, 새 온라인 workspaceId 기준으로 운영한다. 고정 kind와 가변 연결 상태를 분리해 헤더/목록/전환메뉴/생성 검토·완료에아이콘+텍스트배지를표시한다. 수정시안은24상태·3테마·3배치이며유형전환도구는시안용일뿐제품에제자리온라인전환스위치를제공하지않는다. 별도앱/설치방식은아직미확정. 실제제품/Cloud/원본변경없고수정시안검토가다음이다.

## A안 확정·목록/실행 분기 기반(최신)

수정시안은6b07b75에푸시했고 사용자가A안(기존설정확장)을선택했다. 다시선택을묻지않는다. [69문서](69-workspace-registry-runtime-foundation.md)에 독립registry/순수유형상태/owner검증·온라인오류fallback금지·late응답폐기/handle정리를구현했다. 실제native/UI/계정vault/cacheheader gate연결은다음이며 이번제품/Cloud변경은없다. 별도앱/설치정책은A안선택과별개로미확정이며기존로컬모델원칙을유지한다.

## A안 화면과 reference bridge 연결(최신)

이전 기반은 9df4481로 푸시됐다. [70문서](70-a-settings-bridge-integration.md)에 A안 browser controller → 명령 bridge → 별도 registry/읽기 전용 가상 DB19 연결을 기록했다. 새 테스트 29개 + 기존 206개 = 235개 통과, 브라우저 3테마/3폭 9배치·원본 해시 보존을 검증한다. 실제 제품/native/Cloud/기존 config는 미변경이다. 제품용 cache/활성화 어댑터가 다음이며 별도 설치 정책·OS vault·기존 appController 재사용·실기 관문은 남았다. 생성/로그인/받기는 비활성이고 PoC 사본은 제품 활성화로 열지 않는다. A안은 확정이므로 재선택을 묻지 않는다.

## main 1.24.3 동기화(최신)

[71문서](71-main-1.24.3-sync-checkpoint.md): V2 8dde178을 보존하고 main 30a4a9a까지 4개 커밋을 5bdd4f3로 병합했다. 현재 앱1.24.3/DB19. 사진 dialog/메모 팔레트 위치/데일리 버튼/티저 푸터·모션 버튼 개선 반영. 앱532·V2 235·Chromium26개 통과, lint/format/build/문서 정합 통과. PoC 실행 환경 lint 선언과 생성 manifest 포맷 경계만 추가 정리했다. main/Cloud/원본은 직접 수정하지 않았다. 다음은 70문서의 제품용 온라인 캐시·활성화 어댑터이며 A안은 확정이다.

## 온라인 캐시 형식·읽기 검증(최신)

main 동기화는 fcc29aa까지 푸시되어 있다. [72문서](72-online-cache-format-activation.md)에 별도 application_id/user_version·원본 보호·metadata-only records/Blob refs/envelopes·단기 원격 확인을 구현했다. 새73 + 기존235 = 308개 회귀, lint/format 통과. 실제 제품/native/Cloud/원본은 미변경이다. 현재 PoC 증표는 그대로 거절하며 snapshot-read 확인도 productActivationAllowed:false로 제품 편집 런타임에 승격하지 않는다. 다음은 native 프로필/설정/OS 자격증명 격리이며 실제 설치 식별 정책은 별도 미확정이다. 제품 캐시 native 포트·서버 제품 API·편집/동기화/전원 중단 복구·실기는 남았다. A안은 확정이다.

## Connected Preview 실행 정책 확정·native 격리(최신)

8169a44는 원격과 일치하여 재푸시만 확인했다. 사용자가 별도 Connected Preview 검증판을 선택했으므로 다시 묻지 않는다(정식 V2명칭/배포 채널은 별개). [73문서](73-connected-preview-native-isolation.md): Node/Rust 공통 profiles.tsv, Rust 환경별 경로 계획·보호 루트·native vault scope와 Windows/macOS API 소스를 구현했다. Rust31·Node311개 통과와 OS binding의 host 타입 검사를 수행했다. 실제 OS vault 호출/설치/Classic Tauri 연결·Cloud 변경은 없다. native library만 있으며 다음은 Preview 실제 bootstrap/명령 경계 연결, OS 서명/저장소/공존 실기다. 기존 로컬판1.24.3/DB19·A안·캐시 제품 승격 금지 원칙을 유지한다.
