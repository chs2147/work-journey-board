# 47. V2 진행 항목·사용자 직접 설정·재개 순서

**최신 체크포인트(2026-11-10 KST):** [55문서](55-supabase-private-storage-live-results.md) 기준. DEV Free/Usage(U07), 서버 키(U08), 실제 Auth/private 파일/loopback gateway47검사 및 cleanup 완료. 공개 배포·제품/실기·이미지 dedup는 남으며 다음은A06 격리→A07/A08이다. 아래 과거 상태는 당시 기록이다.

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
| U07 | 개발/운영 Free 상태와 Usage 확인, 실제 token 권한 UI에서 접근 범위 확인 | 제공자/사용자 근거와 확인 시각 기록 | DEV Free/Storage/Egress 사용자 화면 확인 완료(55문서), 조직 API403은 유지 |
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

## Blob 후속 검토(2026-11-10 KST, 최신)

A11의 [53문서](53-blob-selection-and-verification-plan.md)에 공식 Free 과금/지역/Workers 조건·이미지500/2,000/10,000개 예산을 추가했다. 월0원·아시아 유지 초기 후보는 Supabase private Storage, 공간 확대 후보는 R2 Standard다. 사용자의 지역 힌트 허용 여부 답변과 실제 Free/Usage(U07), 공급자 확정은 남았다. A05 실제 파일 시험은 가상 표본3개/각64KiB 이하·private/계정 격리·취소/정리 계획까지만 구성했으며 아직 버킷/파일은 만들지 않았다. 제품 dedup·압축·전송이 완성됐다는 뜻이 아니다.

## Supabase 공급자 확정(2026-11-10 KST, 최신)

A11 초기 공급자는 사용자 결정으로 Supabase private Storage로 확정했다([54문서](54-supabase-storage-decision.md)). R2/B2/Vercel 추가 가입/비교는 출시 선행 작업에서 제외한다. A05 실제 파일 시험은 U07 개발 조직 Free/Storage/Egress 확인 후 진행한다. 개발 Storage 목록200/bucket0/object0/RLS true만 확인했고 metadata0bytes는 청구 Usage가 아니다. 지역 힌트 질문은 현재 불필요하며 새 Secret 입력/환경 게시/Pro 결제는 요청하지 않는다.

## 개발 private 파일 실검증 완료(2026-11-10 KST, 최신)

U07은 사용자 DEV 대시보드의 Free/Storage0/1GB/Egress0/5GB 표시로 완료다. 조직API403은 그대로이며 화면0은 반올림 가능하다. [55문서](55-supabase-private-storage-live-results.md)의 실제 파일3종/무결성/중복 재시도/계정 격리/응답 유실·복구/취소/동시quota/세션 회수47검사와 cleanup4항목이 통과했다. A05는 DEV Auth/Storage/loopback gateway까지 완료, 공개 배포·네이티브 로그인/실기/메일은 미완료다. 다음은A06 V1/V2 격리 및A07/A08 제품용 자산/dedup/압축 검토다. 제품/운영/과금/환경 변경은 없다.

## 로컬 영구 유지·이미지 의미 정정(2026-11-10 KST, 최신)

[56문서](56-local-permanence-copy-migration.md)/CLAUDE.md에 사용자 철칙을 고정했다. A06/A07의 핵심은 원본 구조/이미지 영구 유지·명시적 새 온라인 사본·온라인 DB/Blob 이중 본문 저장 금지다. 이미지끼리 hash 공유는 별도 최적화다. 신규 독립 추출22개+기존 DB18회귀19개 통과. 앱/설정/설치/업데이트 분리와 실제 이관 업로드/재개/취소 연결은 미완료다. 예전 BLOB 모형/staging을 최종 온라인 저장소로 사용하지 않는다. 이번 작업은 가상 로컬 시험뿐이며 실제 사용자 DB/클라우드는 변경하지 않았다.

## 실행 격리 PoC 진척(2026-11-10 KST, 최신)

A06의 [57문서](57-runtime-isolation-and-migration-handoff.md)에 후보 profile/업데이트 차단/로컬 cloud 초기화0/서버 완료 callback/경로 중첩 거절을 구현·71개 검증했다. 원본 폴더의 파일 목록/hash를 보존한다. 실제 native 앱/설정/업데이트 분리와 Win/macOS 실기는 아직 미완료다. 다음은 이관 작업/manifest의 이미지 본문 없는 영속 상태·서버 도메인 매핑·재개/취소·서버 완료 증표 연결이다. 기존64KiB gateway와 본문 없는DB 원칙은 유지한다.

## 이관 영속 상태/재개 PoC(2026-11-10 KST, 최신)

[58문서](58-durable-migration-resume-cancel.md)의 독립 migration journal/coordinator에서 신규32개와 회귀71개 통과. 이미지 본문 없는 job/asset 상태·계정/기기scope·lease/fence/취소epoch·업로드/게시/삭제응답 유실·SIGKILL 복구·원본 이후편집 미수집을 확인했다. remote port는 테스트 어댑터이며 서버에서 I/O 종료/취소 경계/전체 검증·완료증표를 보장하는 실제RPC가 다음이다. A06 native 격리, A07 서버 도메인매핑·제품이미지/GC, A08 품질·A09실기/제품동기화는 계속 미완료다.

## 실제 PostgreSQL 이관 서버 검증(2026-11-10 KST, 최신)

[59문서](59-postgres-migration-server.md)의 실제PG 서버39개가 통과했다. 새전진SQL/ACL/빈rollback/reviewmanifest까지 준비했으나 DEV에는 미적용이다. 새RPC는 server role만 실행, 본문없는 이미지참조·최신readback/IO·ticketfence·원자적publish/cancel을 검증한다. 최소문서프로필의poc-verified는 제품활성화에 사용 금지. 다음은 전체DB18 mapper/프로필·source-targethash 이중바인딩·실제gateway새RPC 어댑터→DEV통합이다. A06native격리/전체제품이관은 미완료다.

## 전체 DB18 매핑·RPC 연결(최신)

[60문서](60-db18-workspace-map-gateway.md)의26테이블 매핑17개·HTTP16개·실제PG40개가 통과했다. 전체 데이터 봉투와 최소 서버 프로필을 구분해 축약 전송을 거절하며 source/target manifest를 별도로 바인딩한다. Cloud/제품은 변경하지 않았다. 다음은 전체 서버 프로필·journal 영속 바인딩·실제 Storage 연결이며 로컬 영구 유지/새 사본 철칙을 유지한다.

## main 1.24.1 동기화·다음 우선순위(최신)

사용자 요청으로main ae97c10까지12개 커밋을v2-design에 반영한다([61문서](61-main-1.24.1-sync-checkpoint.md)). 제품 기준은1.24.1/DB19이며 기존 이관은DB18 전용이다. DB19를 원본 변경 없이 거절하므로 다음은delete_locked 보존/복원 및 버전별 계약 검증을 우선한다. 이후 전체 서버 프로필/journal 이중 해시/Storage 연결을 계속한다. V2를main에 병합하거나 Cloud에 적용하지 않았다.

## DB19 이관 계약·왕복 검증(최신)

[62문서](62-db19-copy-contract-compatibility.md)에 요청1번을 구현했다. DB18 전용 API/계약은 유지하고 DB19 사본 추출·잠금0/1 매핑·새 파일 왕복 복원과 본문 revision 트리거를 검증한다. 신규9개+기존136개 시험을 수행한다. 제품/원본/Cloud는 수정하지 않으며 다음은2번 전체 봉투 서버 저장/검증이다.

## 전체 워크스페이스 서버 저장·검증(최신)

[63문서](63-full-workspace-server-profile.md)의 새전진004가 DB18/19 전체 봉투를 검증·저장하고 기존 게시/취소 경계와 재구성 해시를 적용한다. 새2테이블 RLS/직접ACL차단·미사용006rollback을 준비했다. 제품활성화/Cloud적용은 없으며 다음은3번 gateway/journal 전체 프로필·이중해시 연결이다.

## 전체 프로필 gateway·journal 연결(최신)

[64문서](64-workspace-gateway-journal-binding.md)에 전체 프로필 opt-in RPC와 journal version2 보존 업그레이드·해시 이중 바인딩/매핑 지문을 구현했다. 실제 HTTP/PG/SQLite 재열기로 제어 응답 유실을 확인하며 PoC 완료는 제품 활성화로 바꾸지 않는다. 다음은4번 실제Storage전송/readback/취소부재확인이다. 이미지 없는 제어 통합과 실제파일 이관을 구분하며 Cloud에는 미적용이다.

## Storage I/O·readback·취소 연결(최신)

[65문서](65-workspace-storage-io.md)에 전체 이관/Storage/C2 연결과 journal version3을 구현했다. 확정된 HTTP 응답만 정산하고 bytes hash/최신attest를 요구하며, 취소 후 모든IO정산/삭제부재 확인 전에는 quota를 반환하지 않는다. 로컬PG+Storage HTTP표본9시나리오와 journal/기존회귀를 검증한다. 실제Cloud미적용이며 다음은5번 DEV전진SQL 검토/실제통합이다.

## DEV 실제 이관·KeepAlive 정규 실행 확인(최신)

[66문서](66-development-migration-live-results.md)에 DEV새001/004 적용·기능44개/정리4개 통과를 기록했다. 26테이블 DB18/19·잠금·실제Auth/Storage·응답유실/취소복구를 확인했고 모든 표본을 정리했다. C1/C2/KeepAlive설정 불변, 정규cron첫실행 succeeded도 확인해 기존 미관측 항목을 완료했다. 새모듈은 설치상태로 유지하며재실행하지 않는다. 다음은6번 제품격리/연결UI 검토다. 운영/로컬제품/결제/환경은 변경하지 않았다.

## 제품 실행 격리·연결 UI 설계 검토(최신)

[67문서](67-product-isolation-connection-ui.md)에 A설정확장/B공간허브/C측면패널 시안과20상태·3테마를 작성했다. 별도Preview/Classic의설정·저장·인증·업데이트분리, 원본read-only사본, 제품용캐시/증표/OTP관문을상세화했다. 추천A이나미확정이며 제품구현전시안검토를기다린다. mockup은가상화면만표현하며Cloud/기존앱을변경하지않는다.

## 기존 공간 유지·온라인 신규 운영·유형 표시(최신)

사용자 피드백에 따라 [68문서](68-workspace-type-operating-rules.md)에 기존 오프라인전용공간 영구유지/신규온라인운영을 명확히했다. 고정offline_only/online배지는인터넷·로그인상태와독립적이며연결이끊겨도온라인유형을유지한다. 최상위기능명은온라인워크스페이스만들기이며새로시작/오프라인기록으로시작을구분한다. DB19를수정하지않고기존항목은읽을때오프라인전용으로표시한다. UI시안만수정/제품과Cloud는미변경이다.
