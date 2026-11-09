# 45. 개발·운영 환경변수 계약

2026-11-09 UTC · v2-design · 환경 설정 제안/입력 규칙. 실제 환경 변수/비밀을 변경하거나 게시하지 않았다.

## 결론

한 쌍의 공통 ref/token을 번갈아 덮는 방법 대신 **환경별 접두어 + 명시적 실행 대상**으로 관리한다. 이 문서는43~44문서의 공통 변수 교체 안내에 우선한다. 아직 앱/PoC 실행기가 이 계약으로 모두 전환됐다는 뜻이 아니다. 현재 실제 환경은 이전 공통 변수 이름을 사용하며 새 이름의 readiness/접근 확인이 남아 있다.

## 지금 설정할 변수

| 이름 | 값/종류 | 필요 시점 |
|---|---|---|
| WJB_CLOUD_ENV | development | 지금. production은 명시한 운영 점검/배포 작업에서만 선택 |
| WJB_SUPABASE_DEV_PROJECT_REF | vsphftnmfzfoufasjttd | 지금, 일반 변수 |
| WJB_SUPABASE_DEV_MANAGEMENT_TOKEN | 개발 프로젝트 접근/승인된 SQL 설치가 가능한 Management API token | 지금, Secret |
| WJB_SUPABASE_PROD_PROJECT_REF | hutqsfftioxtredcjhsy | 지금, 일반 변수. 운영 예정 환경 |
| WJB_SUPABASE_PROD_MANAGEMENT_TOKEN | 운영 예정 프로젝트 점검용 연결. 현재 관측된 읽기 전용 연결을 이 용도로 구분 가능 | 운영 점검을 할 때만 Secret. 개발만 할 때 미설정 가능 |

URL은 project ref에서 `https://<ref>.supabase.co`로 만든다. 같은 주소를 별도 URL 변수에 중복 입력해 어긋나게 하지 않는다. 실제 네트워크 허용에는 api.supabase.com과 개발/필요 운영 프로젝트 호스트를 각각 포함해야 한다. Management token의 전달 목적지는 api.supabase.com으로 유지하며 프로젝트 호스트에 PAT를 보내지 않는다.

**변수 접두어나 이름은 실제 IAM 권한 제한이 아니다.** PAT가 여러 프로젝트에 접근한다면 DEV라는 이름만으로 PROD 접근이 차단되는 것은 아니다. 발급 계정·조직/프로젝트 접근·지원되는 토큰 권한과 실제 실행 역할을 별도로 검증한다. 현재 개발 GET403과 운영 예정 SQL readonly 결과는42/44문서 증거를 유지한다.

## 추후 필요한 실행용 자격증명

현재 단계에서 아래 키를 미리 발급하거나 제공할 필요는 없다. 해당 기능을 구현할 때 필요한 것만 별도 Secret에 추가한다.

| 용도 | 개발/운영 이름 | 적용 경계 |
|---|---|---|
| 서버 Auth/Storage/API | WJB_SUPABASE_DEV_SERVICE_ROLE_KEY / WJB_SUPABASE_PROD_SERVICE_ROLE_KEY | 서버 전용. Management API 토큰 대체 아님. 새 secret key 체계를 쓰면 검토된 서버 어댑터에 맞는 명칭/헤더로 확정 |
| 앱 공개 접속 | WJB_SUPABASE_DEV_PUBLISHABLE_KEY / WJB_SUPABASE_PROD_PUBLISHABLE_KEY | 공개 키+사용자 로그인. 서버 관리자 권한이 아님 |
| 직접 SQL migration | WJB_SUPABASE_DEV_MIGRATION_DATABASE_URL / WJB_SUPABASE_PROD_MIGRATION_DATABASE_URL | 해당 경로를 선택할 때만 Secret. SSL/대상/비밀·네트워크 검증 필요 |

운영 migration 자격증명은 평상시 개발 채팅 환경에 넣지 않고 운영 릴리스용 보호된 환경에서만 제공하는 구성을 추천한다. 운영 점검용 토큰과 운영 migration 쓰기 연결은 용도를 분리한다. server secret/PAT/DB URL을 VITE_ 변수에 넣거나 desktop/web 번들에 포함하지 않는다.

## 선택·검증 규칙

1. WJB_CLOUD_ENV는 development 또는 production을 명시한다. 비어 있거나 알 수 없는 값이면 실행을 중단한다. 예시 파일에서는 development를 선택한다.
2. development이면 DEV_PROJECT_REF/DEV_MANAGEMENT_TOKEN만 읽는다. PROD 값이 있어도 자동 대체하지 않는다. production도 같은 원칙으로 PROD만 읽는다.
3. ref가 등록된 dev/prod 식별자와 다르거나 둘이 같으면 중단한다. 실제 프로젝트 GET/ref·선택한 manifest 대상·인증 issuer·gateway URL도 일치해야 한다.
4. 실행 시 선택 환경/ref/호스트/권한 관측 결과만 기록한다. 토큰·DB URL의 비밀번호는 출력하지 않는다.
5. production 선택 자체가 쓰기 허가는 아니다. 쓰기는 검토된 작업 범위·SQL artifact·운영 연결에 따라 별도로 제한한다. Git main push를 운영 DB 자동 쓰기에 직접 연결하지 않는다.
6. Management API GET200은 SQL 쓰기 권한 성공이 아니다. SELECT로 실행 역할/readonly를 확인하고 검토된 DDL 적용 후 실제 verify까지 확인한다.

위는 앞으로 실행 경계에 적용할 계약이다. 현재 기존 ref에 고정된 PoC manifest/preflight/issuer/gateway를 범용화하거나 새 dev bundle로 연결하는 구현은 아직 남아 있다. 사용자가 새 변수 설정을 적용하면 이 계약으로 명시적으로 개발 변수를 읽는 점검부터 진행한다. 이름만 바꿔 이전 운영 관측 성공을 개발 성공으로 재사용하지 않는다.

## 기존 변수 전환

- WJB_SUPABASE_PROJECT_REF / WJB_SUPABASE_MANAGEMENT_TOKEN은 **전환 대상**으로 표시한다. 새 이름과 혼용하거나 자동 fallback하지 않는다.
- 기존 실제 ref는 운영 예정 ref와 같았다. 기존 token은 운영 예정 프로젝트 조회에 성공하고 SQL 실행은 readonly였으며, 새 개발 프로젝트 GET은403이었다. 이름 변경으로 권한이 바뀌는 것은 아니다.
- 기존 토큰을 운영 점검용으로 유지하려면 환경 UI에서 비밀 바인딩 이름을 PROD_MANAGEMENT_TOKEN으로 변경/재등록한다. 새 개발 접근 가능한 토큰은 DEV_MANAGEMENT_TOKEN에 별도 등록한다. 같은 비밀을 두 환경에 복사하는 것을 기본으로 삼지 않는다.
- 새 개발 연결을 확인한 뒤 기존 공통 변수를 제거하고 관련 임시 점검 명령도 새 이름을 쓰도록 전환한다. 현재 비밀을 먼저 폐기하거나 무단 회전하지 않는다.

비밀 없는 [설정 예시](../../poc/v2-cloud/environment.example)는 입력 안내이며 자동 로드/실행되지 않는다. 토큰 자리에는 실제 값을 커밋하지 않는다.

## 최신 설정 진행 상태

운영 ref 새 항목만 초안 revision2로 저장됐고 실제 실행 환경은 기존 공통 변수 이름을 유지한다. Secret 이름 자동 변경은 도구의 기존 바인딩 충돌 제한으로 거절됐다. 사용자가 직접 해야 할 이름 편집·개발 토큰 입력·호스트 추가·저장/게시와 에이전트 후속 작업은 [47 진행 항목](47-active-work-items.md)에 U01~U07/A01~A10으로 관리한다.

## 게시 후 연결 검증

사용자 게시 후 DEV/PROD 신규 변수·Secret/개발 호스트 적용을 확인했고 [49문서](49-published-environment-validation.md)에 재검증 결과를 기록했다. 명시 선택기는 cloud-environment.mjs로 구현했다. 기존 고정 SQL/gateway 전체가 전환됐다는 뜻은 아니며, 기존 공통 ref가 있어도 선택기는 자동 fallback하지 않는다.
