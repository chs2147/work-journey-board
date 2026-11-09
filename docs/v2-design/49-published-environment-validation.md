# 49. 환경 게시 후 개발 접속·SQL 실행 세션 재검증

2026-11-09 KST · v2-design · 앱1.23.3/DB18 유지

## 결과

사용자가 환경 저장·게시 완료를 알린 뒤 새 실행 환경의 readiness와 실제 API 접속을 확인했다. **개발 프로젝트403은 해소됐다.** 환경을 다시 수정/게시하지 않았고 DB DDL도 실행하지 않았다.

| 점검 | 실제 결과 |
|---|---|
| 실행 환경 | 새 environment_id, observations_current=true, network policy=enforced |
| 실행 선택 | WJB_CLOUD_ENV=development, DEV ref=vsphftnmfzfoufasjttd, PROD ref=hutqsfftioxtredcjhsy |
| DEV/PROD 관리 Secret | 새 환경변수 이름으로 모두 ready. 값/키는 출력·기록하지 않음 |
| 개발 호스트 | 허용 정책에 포함 |
| 개발 프로젝트 | HTTP200 / WJB DB DEV / ACTIVE_HEALTHY |
| 개발 리전 | ap-northeast-2 서울. 기존 운영 예정은 도쿄. 양쪽을 같다고 기록하지 않음 |
| SQL 실행 세션 | /database/query에 read_only:false와 SELECT만 전송. postgres / transaction_read_only=off / default=off / recovery=false |
| 기존 객체 | 새 schema2개·동명 RPC·전용 bucket 없음, Storage 객체0 |
| Auth | 필수6컬럼 타입 일치, 세션0/0/false |
| 물리 DB |10,909,363 bytes. 공식 무료 잔여량으로 간주하지 않음 |
| 개발 플랜/Usage | 미확인. 운영 예정 프로젝트의 Free/0.026GB 기록을 복사하지 않음 |

[실제 응답 증거](evidence/development-published-access.json)는 허용 필드만 포함한다. SQL 세션이 읽기쓰기로 관측됐다는 것은 실제 DDL 성공 검증과 다르다. 설치 전 생성 권한·target·충돌/설정·무료 조건을 함께 확인한다. 서울은 기존 아시아 범위에 들어가며, 같은 리전 추천과 실제 배정을 구분해 계측/지연 설계에 반영한다.

## 환경 선택기

[cloud-environment.mjs](../../poc/v2-cloud/cloud-environment.mjs)는 env 객체를 명시적으로 받아 DEV 또는 PROD 하나의 고정 ref/토큰을 선택한다. 기본값/공통 변수/다른 환경 credential로 fallback하지 않는다. production에서 개발 설치 operation을 요청하면 거절한다. 이 operation 선택은 실제 DDL 실행이나 사용자 작업 범위 승인 자체를 대신하지 않는다.

결과 객체의 token은 일반 JSON/Object.keys에 포함되지 않게 했고 실제 값은 사용 시 HTTPS header에만 전달한다. 비밀값을 일반적으로 로그에 안전하게 출력할 수 있다는 의미는 아니다. 선택기 자체는 API/DB 요청을 수행하지 않는다. 현재 새 런타임의 변수로 선택기를 실행해 개발 대상/서울 리전/공개 metadata만 반환하는 것을 확인했다.

[검사](../../poc/v2-cloud/cloud-environment.test.mjs)10개는 잘못된/누락된 환경·ref, 개발 토큰 누락 시 운영/legacy 대체 금지, 운영 설치 차단, header injection과 비밀 직렬화 방지를 검증한다. 가상 키만 사용한다.

```sh
node poc/v2-cloud/cloud-environment.test.mjs
```

기존 SQL bundle/preflight/Auth issuer/gateway가 새 개발 설정으로 전부 바뀐 것은 아니다. 운영 예정 대상의 묶음/과거 관측은 보존한다. 개발용 manifest/marker/준비 검사·실행 연결은 별도로 재구성해야 한다.

## 남은 순서

1. 개발 Free/Usage와 생성 역할 권한 확인. 이전 프로젝트의 용량/계정 조건을 재사용하지 않음.
2. 서울 개발 ref를 고정한 별도 DB-only 묶음과 검토·시험·설치 기록 구성.
3. 실제 개발 설치·ACL/RLS/소유자 검증 후 가상 Auth/private 자산 검증.
4. Blob 공급자 선택·실물 dedup schema/품질 정책은48/46문서 별도 후속 범위. 현재 설치 묶음에 자동 추가하지 않음.

기존 공통 WJB_SUPABASE_PROJECT_REF는 런타임에 남아 있다. 새 선택기는 읽지 않으며, 임시 명령/기존 도구 전환이 끝난 뒤 정리한다. 새 Secret 이름 편집/개발 토큰/호스트 적용을 반복 요청하지 않는다. 실제 클라우드 쓰기·운영 접속·버킷/파일 생성·앱/main/환경 게시 변경은 수행하지 않았다.
