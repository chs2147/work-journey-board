# V2 설계·PoC 중단/재개 기록

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

언어 리소스/배포·플랫폼 기능표·인증/동기화/전환/충돌/복구/비용 설계와 독립 PoC를 보존했다. 로컬 SQLite214개, JWT28개, HTTP61개, 영속/복구 통합41개 등은 각 단계 문서의 **서로 다른 범위·실행 시점** 결과다. 합산하여 제품 완성도나 실제 클라우드 검증으로 해석하지 않는다.

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
