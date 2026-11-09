# 44. 개발 프로젝트 확정·접근 설정 대기

2026-11-09 UTC · v2-design · 앱1.23.1 / DB18 유지

## 프로젝트 분리

사용자가 개발 프로젝트 URL `https://vsphftnmfzfoufasjttd.supabase.co`를 제공했다.

| 용도 | project ref | 현재 상태 |
|---|---|---|
| 개발 | vsphftnmfzfoufasjttd | 사용자 지정. 현재 관리 토큰의 프로젝트 GET403 |
| 운영 예정 | hutqsfftioxtredcjhsy | 기존 프로젝트. 개발 SQL을 여기에 재시도하지 않음 |

[초기 조회 증거](evidence/development-project-initial-access.json)는 새 ref에 대한 Management API GET1회만 포함한다. 프로젝트 GET이403이므로 후속 Auth/DB/Storage 조회·DDL은 수행하지 않았다. region/Free 상태·실제 SQL 실행 역할·쓰기 권한은 **미확인**이다. 기존 프로젝트의 읽기 전용 실행 결과를 새 프로젝트의 결과로 재사용하지 않는다. 403이 PAT scope/조직 접근/발급 계정 중 어느 원인인지는 단정하지 않는다.

[대상 대기 기록](../../poc/v2-cloud/development/target.pending.json)에 개발·운영 예정 식별자, 현재 런타임 ref, 기존 묶음 대상과 실행 금지를 보존한다. **실행 설정으로 아직 연결하지 않은 기록용 파일**이다. developmentBundlePrepared=false, executionEnabled=false이며, 새 대상의 SQL 묶음이 완성됐다는 뜻이 아니다.

## 환경에서 바꿀 항목

현재 관측된 환경은 여전히 기존 project ref를 사용하며 허용 호스트에 새 개발 호스트가 없다. 준비된 설정은 다음과 같다.

| 항목 | 변경값/작업 |
|---|---|
| WJB_SUPABASE_PROJECT_REF | vsphftnmfzfoufasjttd |
| WJB_SUPABASE_MANAGEMENT_TOKEN | **새 개발 프로젝트가 보이는 Supabase 계정**에서 발급하고 개발 SQL 설치 권한을 확인한 Management API 토큰을 비밀 입력에 등록 |
| 네트워크 허용 | vsphftnmfzfoufasjttd.supabase.co 추가 |
| 기존 호스트 | api.supabase.com, GitHub/패키지 호스트 등 유지. 운영 예정 호스트 삭제는 이번 필수 작업 아님 |

[Access Tokens](https://supabase.com/dashboard/account/tokens)에서 발급 계정과 조직 접근·지원되는 권한 범위를 확인한다. 프로젝트 ID만 바꿔도 토큰의 접근 권한이 생기지는 않는다. 토큰이 dev라는 이름을 가진다고 프로젝트별 IAM 제한이 생기는 것도 아니다([43문서](43-dev-prod-database-setup.md)). 정확한 UI 권한 항목이 확인되지 않은 상태에서 전체 관리자 권한을 일괄 요청하지 않는다. service-role 키나 DB 비밀번호를 Management API 토큰 대신 입력하지 않는다.

기존 비밀은 새 개발 연결을 확인하기 전 임의로 폐기하지 않는다. 비밀값은 채팅/Git에 넣지 않고 환경 설정의 Secret 입력을 사용한다. 환경 변경을 저장/적용한 뒤 알려주면 새로운 상태와 새 연결을 확인한다. 현재 도구에서 환경을 변경/게시하지 않았다.

## 설정 적용 후 작업 순서

1. 환경 ref/허용 호스트/비밀 readiness가 개발 대상으로 맞는지 확인한다.
2. Management API 프로젝트GET200·상태/리전/플랜을 확인한다. 이어 SQL SELECT로 실제 실행 역할/transaction_read_only를 확인한다. 읽기 접근 성공을 쓰기 권한 성공으로 대체하지 않는다.
3. dev에 맞는 manifest/marker/준비 검사/Auth issuer·gateway 대상 구성을 만들고 별도 관측/시험으로 검증한다. 기존 대상의 검토 hash·권한·용량 성공 flag를 복사하지 않는다. 운영 묶음·과거 증거를 보존한다.
4. 개발 DB-only 설치→실제 ACL/RLS/소유자 확인→개발 가상 사용자/비공개 자산 검증을 진행한다. 기존 대상의 install.sql을 먼저 실행하는 순서로 우회하지 않는다.

이번 작업에서 새 DB 설치·토큰/권한 변경·운영 쓰기·제품 코드/main·환경 게시는 수행하지 않았다.
