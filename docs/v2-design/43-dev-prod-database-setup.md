# 43. 개발·운영 DB 분리와 권한 재구성 절차

2026-11-09 UTC · v2-design · 사용자 요청에 따른 구성 안내. 아래 프로젝트 배정은 추천이며 아직 신규 생성/이름 변경/권한 확대/SQL 설치를 수행하지 않았다.

## 추천 구성

초기 월0원 원칙에서는 **별도 Supabase Free 프로젝트2개(운영1/개발1)**를 우선 추천한다. 새 조직/계정의 실제 무료 슬롯이 남아 있고 두 프로젝트가 Free 조건으로 생성 가능한지 콘솔에서 확인한다. 무료 프로젝트 한도는 단순 조직별2개로 가정하지 않고 계정의 owner/admin 참여 조건까지 확인한다.

| 환경 | 추천 대상 | 데이터/적용 원칙 |
|---|---|---|
| 운영 예정 | 기존 hutqsfftioxtredcjhsy, 이름 예시 wjb-v2-prod | 현재 V2 schema0개. 생산 서비스가 이미 운영 중이라는 뜻이 아님. 개발 중 임의 적용하지 않음 |
| 개발 | 새 Free 프로젝트, 이름 예시 wjb-v2-dev | 가상 계정·업무·자산으로 SQL/Auth/Storage/동기화 시험 |
| 로컬 | Docker/Supabase CLI 또는 기존 독립 PoC | 반복 초기화·장애 주입. 클라우드 시험과 구분 |

사용자가 기존 프로젝트를 개발용으로 쓰고 신규 프로젝트를 운영 예정으로 비워두는 구성도 가능하다. 기존 DB를 복제하거나 삭제할 필요는 없다. 환경 이름만으로 격리가 되는 것은 아니며 **서로 다른 project ref/URL/DB/Auth/Storage 자격증명**이 핵심이다.

공식 [Branching](https://supabase.com/docs/guides/deployment/branching), [Branching usage](https://supabase.com/docs/guides/platform/manage-your-usage/branching)는 branch별 환경과 compute/disk/egress/storage 과금, Spend Cap 미적용을 설명한다([19문서](19-supabase-env-consolidation.md)의 공식 원문 확인 근거). 따라서 관리형 branch를 무료 개발 DB로 간주하지 않는다. Git 브랜치는 코드만 나누고 DB를 자동 격리하지 않는다. 같은 DB의 prod/dev schema 분리도 Auth/Storage까지 완전 격리되는 대안으로 선택하지 않는다.

무료 슬롯이 없다면 먼저 **운영 원격1개 + 로컬 개발 + 별도 클라우드 시험 범위**를 검토한다. 다른 서비스 DB 삭제·유료 전환·새 과금 계정 생성으로 자동 해결하지 않는다.

## 1. 개발 프로젝트 생성

1. Supabase Dashboard에서 현재 프로젝트의 조직/Free 상태와 무료 프로젝트 여유를 확인한다.
2. New project에서 조직을 선택하고 `wjb-v2-dev`처럼 개발용임이 드러나는 이름을 사용한다.
3. 리전은 운영 예정과 같은 **Tokyo / ap-northeast-1**을 우선한다. Free 생성 조건을 확인하고 추가 유료 옵션/Pro/branch/PITR/compute 확장을 선택하지 않는다.
4. 강한 DB 비밀번호를 생성해 비밀번호 관리자에 보관한다. 채팅·문서·Git에 넣지 않는다.
5. ACTIVE_HEALTHY가 된 뒤 새 프로젝트의 **대시보드 URL/project ref**를 확인한다. 이 식별자는 채팅으로 알려줘도 되지만 비밀번호/API secret은 보내지 않는다.
6. 개발 Auth 사용자/SMTP/redirect/bucket/정책은 별도 설정한다. 운영 인증 사용자·파일·업무 원본을 그대로 복사하지 않는다. 기본 SMTP의 발송 대상/횟수 제한은 별도 시험 항목이다.

## 2. 권한을 네 계층으로 구분

| 계층 | 개발 | 운영 |
|---|---|---|
| Dashboard/조직 관리 | 소유자가 프로젝트/연동 관리. 일반 앱 사용자에게 관리 역할 부여 안 함 | 소유자/운영 담당자만 설정·복구·키 회전 |
| 설치/마이그레이션 연결 | postgres 또는 검토된 migration owner로 승인된 DDL. 일반 앱 연결과 분리 | 릴리스 migration 시에만 사용, 평상시 개발 환경에 운영 쓰기 자격증명 미제공 |
| gateway/server 런타임 | 개발 secret/service-role을 서버 비밀 설정에만 저장. 검증된 RPC 경계 사용 | 별도 운영 키/배포 비밀 사용. 개발 키/테스트 seed 반입 금지 |
| desktop/web 사용자 | publishable/anon 공개 키 + 사용자 Auth JWT + 서버 API | 같은 구조. 공개 키는 관리자 권한이 아니며 서버 secret을 번들하지 않음 |

**관리 API PAT와 service-role 키와 DB 비밀번호는 서로 대체할 수 없다.** PAT는 Management API, DB 비밀번호는 SQL 연결, service-role/secret은 서버 API 실행에 사용한다. service-role은 RLS를 우회할 수 있으므로 사용자 앱에 제공하지 않는다. 현재 검토된 DB 묶음은 client 직접 업무 table CRUD를 허용하지 않고 서버 RPC만 연다. 개발 편의를 위해 PUBLIC/anon/authenticated에 광범위 GRANT를 추가하거나 RLS를 끄지 않는다.

## 3. 현재 읽기 전용 연결 정리

실제 조회 결과는 [42문서](42-cloud-sql-install-attempt.md)에 보존돼 있다. read_only:false 요청도 실행 역할 supabase_read_only_user / transaction_read_only=on이었다. **DB의 postgres 역할이 쓰기 가능하다는 사실과 현재 API 연결이 그 역할로 실행되는지는 별개**다. 어떤 PAT scope/조직 역할/연동 설정이 원인인지는 아직 단정하지 않는다.

1. [Access Tokens](https://supabase.com/dashboard/account/tokens)에서 현재 연결에 사용한 토큰과 발급 계정/조직 접근 범위를 확인한다. 해당 개발 프로젝트의 SQL 설치 권한을 가진 소유자/관리 계정을 기준으로 한다.
2. 권한 범위 선택을 지원하는 발급 화면이라면 개발 작업에 필요한 **DB/SQL 읽기·쓰기 및 필요한 설정 조회**를 선택한다. 실제 UI 항목명은 화면에서 확인한다. 조직 청구/멤버 관리·프로젝트 삭제 등 무관한 권한을 일괄 추가하지 않는다.
3. 토큰이 프로젝트별로 제한되는지 확인한다. 지원하지 않는 PAT라면 이름만 dev로 붙여도 개발 전용 IAM이 되는 것이 아니다. 환경의 대상 ref/허용 도메인/실행 검사도 함께 두고, 필요 시 개발 자격증명과 조직 경계를 검토한다.
4. 새 개발 토큰을 클라우드 환경의 비밀 입력으로 제공한다. 기존 토큰은 교체 연결 검증 전 성급히 폐기하지 않고, 검증 후 용도에 따라 읽기 점검용 유지 또는 폐기를 결정한다.
5. 연결이 계속 읽기 전용이면 역할/설정을 강제 변경하지 않는다. 개발 프로젝트 SQL Editor 또는 별도 승인된 SSL DB migration 연결을 대안으로 검토한다. 직접 DB 연결은 환경 네트워크/비밀 설정이 추가로 필요할 수 있다.

운영은 평상시 읽기 점검용 연결을 유지하고, 운영 migration 쓰기 연결은 별도 보관한다. 개발 권한 해결을 위해 현재 운영 예정 프로젝트의 모든 사용자 권한을 확대하지 않는다.

## 4. 이 클라우드 환경 설정

기존 코드/실험 실행 스크립트가 현재 사용하는 이름을 유지하면 다음과 같다. **실제 입력은 개발 프로젝트 식별자가 확정된 뒤** 진행한다.

| 설정 | 값/위치 |
|---|---|
| WJB_SUPABASE_PROJECT_REF | 새 개발 project ref. 비밀값 아님 |
| WJB_SUPABASE_MANAGEMENT_TOKEN | 개발 SQL 설치 가능한 Management API token. 비밀 입력 |
| API 허용 호스트 | 기존 api.supabase.com 유지 |
| 개발 Auth/Storage 허용 호스트 | 새 dev-ref.supabase.co 정확한 호스트 추가 |
| 기존 운영 예정 프로젝트 | ref hutqsfftioxtredcjhsy를 운영 명세에 보존. 개발 실행 기본값으로 사용하지 않음 |
| 운영 쓰기 자격증명 | 이 개발 채팅 환경의 기본 토큰으로 등록하지 않음 |

기존 GitHub/패키지 호스트 등 필요한 환경 설정은 보존한다. 환경 설정을 저장/적용한 뒤 이 채팅에서 갱신 사실을 알려주면 실제 readiness와 새 연결을 확인한다. 키/비밀번호를 채팅에 붙이지 않는다. 기존 관측 JSON의 대상 ref를 새 문자열로 바꿔 이전 성공 결과를 재사용하지 않는다.

## 5. 제가 이어서 할 적용·검증 순서

1. 새 dev ref/조직/리전/Free 상태를 확인하고 prod/dev 식별자 표를 고정한다.
2. **현재 PoC는 기존 ref를 강하게 고정**한 manifest/preflight/gateway/Auth issuer를 사용한다. 새 개발 ref에 맞는 분리된 설정/검토 묶음을 만들고 시험한다. 기존 install.sql을 새 대상으로 검토 없이 복사 실행하지 않는다. 운영 묶음과 관측 증거는 보존한다.
3. SELECT로 실제 실행 역할과 transaction_read_only, Auth6컬럼/권한·세션 설정·이름 충돌을 확인한다. read_only=false 요청에도 readonly라면 여기서 멈추고 연결 원인을 확인한다.
4. 검토된 개발 DB-only 설치를 실행하고 스키마2/table6/function7 및 ACL/RLS/소유자를 확인한다. 응답 유실이면 읽기 verify부터 수행한다.
5. 개발 전용 private bucket·가상 계정2개·최소 표본으로 서버/API·기기 회수·자산 접근 차단을 검증한다. 메일·Keep Alive와 비용/휴면 효과는 별도로 시험한다.
6. 스키마 변경은 버전 migration으로 저장하고 local/dev에서 검증한다. dev 자료/Auth 사용자/secret을 운영으로 복제하지 않는다.
7. 운영 적용은 검증된 migration artifact·운영 ref·되돌리기/보존 절차를 확인한 릴리스 단계로 분리한다. Git main push 자체가 운영 DB 변경을 자동 실행하도록 연결하지 않는다.

## 지금 사용자 작업

**우선 별도 Free 개발 프로젝트를 생성하고 그 대시보드 URL만 알려준다.** 이후 개발 SQL 설치 가능한 연결을 환경 비밀 설정으로 준비한다. 기존 프로젝트를 dev로 사용할 계획이라면 그 배정을 알려주면 동일 순서로 식별자 표를 조정한다. 현재까지 새 프로젝트·권한·토큰·SQL/Storage 변경은 수행하지 않았다.
