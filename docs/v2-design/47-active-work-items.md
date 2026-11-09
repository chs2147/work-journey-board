# 47. V2 진행 항목·사용자 직접 설정·재개 순서

**최신 체크포인트(2026-11-10 KST):** [52문서](52-development-auth-live-results.md) 참조. U08 HTTP 시크릿 ready 및 실제 서버 RPC 검증 완료. 개발 Auth 임시계정2개/ES256/세션 회수/공간 소유자 격리20검사와 잔여0 정리 확인 완료. A05는 Auth/metadata까지 완료이며 Blob·공개 gateway/실기·메일 흐름은 미완료다. U07 개발 Free/Usage는 남아 있다. 아래의 과거 상태는 당시 기록이며 이 체크포인트가 우선한다.

2026-11-09 UTC · v2-design · 현재 실행 환경과 저장 초안을 구분한다. 과거 결과/관측을 덮어쓰지 않는다.

## 환경변수 운영 규칙

[45 환경변수 계약](45-environment-variable-contract.md)을 정본으로 유지한다. WJB_CLOUD_ENV=development를 명시하고 DEV/PROD ref와 Secret을 분리한다. 선택 환경의 값이 없으면 중단하며 기존 공통 변수/다른 환경으로 자동 fallback하지 않는다. PAT 이름 분리가 실제 IAM 격리를 보장하지 않으므로 대상·토큰 접근·SQL 실행 역할을 각각 확인한다. 운영 쓰기 자격증명은 개발 환경 기본값으로 제공하지 않는다.

Management token은 api.supabase.com에만 전달한다. 서버용 service key/DB 비밀번호는 PAT 대체물이 아니며 앱 번들·VITE_ 변수·Git·로그에 포함하지 않는다. 키 변경은 검증 후 구 키 정리 순서로 하고 현재 동작 중인 바인딩을 먼저 폐기하지 않는다. dev/prod 관측·Usage·검토 hash·설치 증거도 분리한다.

## 현재 확인된 환경 상태

환경 status는 기존 WJB_SUPABASE_PROJECT_REF와 WJB_SUPABASE_MANAGEMENT_TOKEN만 ready로 보고한다. 저장 초안 revision2에는 WJB_SUPABASE_PROD_PROJECT_REF=hutqsfftioxtredcjhsy 제안이 pending이다. 기존 Secret의 변수 대상 이름 변경은 설정 도구가 충돌로 거절했으며 **자동 이름 변경/값 이동/새 Secret 복제는 하지 않았다.** 초안 저장은 실제 적용/게시 완료가 아니다.

새 개발 ref는 vsphftnmfzfoufasjttd, 운영 예정 ref는 hutqsfftioxtredcjhsy다. 마지막 개발 프로젝트GET은403, 운영 예정 SQL 설치 요청은readonly 오류/생성 객체0개였다. 개발 SQL 쓰기 능력·플랜/리전은 미확인이다. 실제 환경이 이후 변경되면 status/새 연결로 재확인해야 한다.

## 게시 후 재검증(최신)

사용자가 환경 저장/게시를 완료해 새 런타임에서 DEV/PROD Secret과 ref, WJB_CLOUD_ENV=development, 개발 호스트 enforced를 확인했다. 개발 GET200/ACTIVE_HEALTHY, 서울 ap-northeast-2, 실제 SQL 조회 postgres/transaction_read_only=off를 확인했다. DDL은 아직 실행하지 않았다. 기존 공통 ref도 남아 있지만 새 선택기는 이를 읽지 않는다.

U01/U03/U05/U06은 적용 확인 완료다. U02는 새 PROD ref 확인 완료·기존 공통 ref 정리 보류다. U04는 개발 접근/읽기쓰기 세션 확인 완료이며 실제 DDL 권한은 설치 단계에서 최종 확인한다. U07의 **개발 Free/Usage**는 미확인이다. 아래 표의 이전403/설정 대기 기록은 변경 전 상태이며 이 절이 최신 결과에 우선한다.

A01의 명시적 환경 선택기를 cloud-environment.mjs로 구현하고10개 검사를 통과했다. A02의 접근/리전/SQL 세션 재점검은 완료했으나 Free/Usage는 남았다. A03 dev 전용 묶음/issuer/gateway 연결과 A04 설치는 미완료다. 운영 연결/기존 고정 bundle을 dev로 자동 대체하지 않는다. [49 재개 결과](49-published-environment-validation.md)를 참조한다.

## 개발 설치·KeepAlive 적용(최신)

[50문서](50-development-database-keepalive.md)에 따라 A03의 개발 전용 DB SQL 묶음 구성과 A04의 실제 설치/ACL 검증을 완료했다. gateway/Auth issuer의 개발 설정 전환은 아직 별도 작업으로 남는다. A05 중 KeepAlive만 건물수첩 방식(pg_cron/매일12:00 KST/단일행)으로 적용했고 동일 명령의 임시 scheduler probe 성공·제거를 확인했다. 정규 일일 job 첫 실행, 실제 Auth 사용자/private bucket/파일/gateway 검증은 미완료다. 개발 Free/Usage 조회는403이며 U07 대시보드 확인은 남아 있다. 실제 생성·권한을 증거로 기록했고 이전 미설치/접근대기 표는 당시 상태로 보존한다. 운영 예정 프로젝트는 변경하지 않았다.

## 인증/gateway 조합 후속(최신)

[51문서](51-development-gateway-auth-wiring.md)의 dev 전용 factory/issuer·REST 대상 연결과 로컬HTTP10개·기존 회귀가 통과했다. 개발 공개 JWKS ES256 GET200을 확인했다. 실제 Auth 사용자/RPC/Storage 시험은 DEV_SERVICE_ROLE_KEY 미설정으로 남아 있다. 새 비밀 항목만 초안 저장했고 사용자가 **WJB_SUPABASE_DEV_SERVICE_ROLE_KEY(개발 legacy service_role)**를 Secret에 입력·적용/게시해야 한다(U08). 목적지는 개발 프로젝트 호스트만이다. 기존 관리 토큰은 수정/복제하지 않는다. Blob 공급자는 아직 미선정으로 bucket/파일 생성은 하지 않았다.

## 사용자가 직접 설정할 항목

| ID | 직접 할 작업 | 완료 기준 | 현재 상태 |
|---|---|---|---|
| U01 | 기존 비밀 항목의 **환경변수 이름** WJB_SUPABASE_MANAGEMENT_TOKEN → WJB_SUPABASE_PROD_MANAGEMENT_TOKEN 편집. api.supabase.com 대상/기존 값 유지 | 신규 PROD 바인딩 ready, 값 노출/중복 Secret 생성 없음 | 직접 편집 대기 |
| U02 | 초안 PROD_PROJECT_REF 값 확인. 새 PROD 변수 적용 후 기존 WJB_SUPABASE_PROJECT_REF 정리 | PROD_REF=hutqsfftioxtredcjhsy, 구 이름은 전환 검증 뒤 제거 | 새 항목 초안만 저장 |
| U03 | 일반 변수 WJB_CLOUD_ENV=development, WJB_SUPABASE_DEV_PROJECT_REF=vsphftnmfzfoufasjttd 설정 | 실제 실행 환경에서 두 값이 일치 | 미설정 |
| U04 | 새 개발 프로젝트가 보이는 계정에서 발급한 접근/승인된 SQL 쓰기용 Management token을 DEV_MANAGEMENT_TOKEN Secret에 입력 | DEV_PROJECT GET200. 쓰기 역할은 에이전트가 별도 검증 | 현재 토큰 GET403 |
| U05 | 허용 호스트 vsphftnmfzfoufasjttd.supabase.co 추가, 기존 api.supabase.com/GitHub/패키지 호스트 유지 | 현재 network policy enforced에 개발 호스트 포함 | 미반영 |
| U06 | 설정 검토·저장·게시 후 적용 사실 알림. 비밀값은 채팅에 보내지 않음 | 새 revision/current readiness 확인 가능 | 대기 |
| U07 | 개발/운영 Free 상태와 Usage 확인, 실제 token 권한 UI에서 접근 범위 확인 | 제공자/사용자 근거와 확인 시각 기록 | 운영 Free/Usage만 이전 확인, 개발 미확인 |
| U08 | HTTP 시크릿 DEV_SERVICE_ROLE_KEY에 개발 legacy service_role 저장 | 새 binding ready 및 실제 서버 RPC 권한 검증 | 완료: 52문서. 게시 버튼이 없으면 저장만 진행 |

토큰 UI가 세부 scope를 지원하지 않거나 기존 비밀의 이름 편집이 안 되면 그 UI의 지원 범위를 확인해 전환 방법을 정한다. 환경 도구가 새 이름으로 값을 자동 복사할 수 있다고 가정하지 않는다. 개발용 서버 키·사용자 공개 키·migration DB URL은 해당 단계에서 필요할 때만 추가한다.

## 에이전트 진행 항목

| ID | 작업 | 선행 | 상태/완료 기준 |
|---|---|---|---|
| A01 | DEV/PROD 명시 선택기·새 변수 읽기 경계 연결 | U03/U04 | 미구현. 누락/혼합/잘못된 ref·운영 fallback 거절 |
| A02 | 개발 접근/리전/Free/실행 역할/readonly 재점검 | U03~U07 | 대기. 과거403/readonly 결과를 새 성공으로 재사용하지 않음 |
| A03 | dev 전용 SQL manifest/marker/Auth issuer/gateway/관측 구성 | A01/A02 | 기존 ref 고정 PoC 유지 중. 운영 묶음 증거 보존하며 분리 |
| A04 | 개발 DB-only 설치/ACL·소유자 검증 | A03 | 미설치. 응답 유실 시 verify 우선, 같은 묶음 중복 적용 금지 |
| A05 | 가상 Auth/private Storage/gateway 실검증·메일/Keep Alive | A04/비용 확인 | 미실행. 계정·파일 전송 범위/실측 증거 분리 |
| A06 | V1/V2 앱 ID·설정·업데이트 채널·복사 전환 설계 잠금 | 46문서 | 미구현. V1 자동 교체/원본 수정/계정 의존 없음 |
| A07 | 온라인 binary AssetStore·blob/reference/variant·quota/GC 설계/PoC | A06 | 새 schema 미구현. 현재64KiB/assetId PoC는 hash dedup 완성 아님 |
| A11 | Blob 공급자 무료 용량·전송·지역·과금 차단 비교 | 48문서 | R2 공식10GB-month 확인. B2/Vercel 현행 요금·계정/지역 조건 및 공급자 선택 미완료 |
| A08 | 가독성/해상도·압축 시안과 OS별 실측 | A07 | 사진/한글 표·스크린샷/투명도/GIF 비교 후 기본값 확정 |
| A09 | 실제 기기 동기화·충돌/복원·오프라인 통합 | A05/A07/A08 | 미완료. 로컬 모형 PASS로 대체 안 함 |
| A10 | ko/en 앱/사이트/가이드/출력 이행·Win/macOS 실기·출시 | A06/A09 | 미구현. 로컬 기존 기능/배포 채널 회귀 관문 포함 |

A06~A08은 **설계/화질 검토를 먼저 진행**하고 제품 DB/이미지 처리 코드는 별도 구현 단계에서 반영한다. 신규 dedup schema/한도 확대는 기존 DB-only 설치 SQL에 자동 포함하지 않는다. U항목 대기 중에도 설계/로컬 가상 비교 작업은 가능하나 실제 cloud 접근 성공으로 보고하지 않는다.

## Blob 저장소 추가 검토

온라인 실물은 private Blob에 저장하고 공급자는 별도 선택한다. [48문서](48-blob-storage-provider-review.md)와 A11에서 Supabase1GB 대비 R2 Standard10GB-month·전송/연산비·아시아 보장·월0원 조건을 검토한다. 새 bucket/결제수단/구독 활성화는 하지 않았다. 저장소 용량이 크다는 이유로 공개 URL이나 기존 로컬 모델 변경을 선택하지 않는다.

## 바로 다음 진행

1. 사용자 U01~U06 설정. 에이전트는 적용 후 새 status/실제 접속으로 확인한다.
2. A01~A04의 개발 우선 경계를 구성한다. 기존 운영 예정 대상의 설치를 계속 재시도하지 않는다.
3. [46문서](46-local-compatibility-image-storage.md)의 로컬 무영향/이미지 정책을 검토하고 A06~A08 구현 명세·품질 비교를 확정한다.

이미 확정된 ko/en·개인 여러 기기·Win/macOS·TLS/서버 암호화·월0원 원칙은 유지한다. 작업 브랜치는 v2-design이고 main 제품·기존 로컬 DB18·설치판에는 이번 문서 작업을 반영하지 않는다.
