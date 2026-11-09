# 40. SQL 실행 역할·Auth RLS 검토

`v2-design` · 2026-11-09 UTC · 앱1.23.0 / DB18 유지

## 결과

`3ddfc8f`의 커밋/원격 반영을 확인하고, [전체 설치 묶음](39-full-bundle-review.md)의 남은 실행 역할 조건을 점검했다. 실제 프로젝트에는 공식 read-only SQL endpoint로 SELECT만 수행했다. 로컬에서는 비 superuser 역할로 전체 설치·실행·중단/재개·빈 설치 제거를 검증했다.

**실행 소유자 기술 검토는 완료했다. 실제 쓰기 자격증명 검증이나 SQL 설치 승인을 뜻하지 않는다.** `migrationOwnerReviewed`만 기술 검토 근거로 갱신했고, bundle/rollback 최종 검토 및 공식 잔여량은 미확인 상태로 유지했다.

## 실제 프로젝트에서 확인한 권한

[조회 SQL](../../poc/v2-cloud/inspect-owner.sql)은 역할/권한/테이블 속성만 조회하며 Auth 사용자 행을 읽거나 SET ROLE을 실행하지 않는다. [원본 결과](evidence/sql-owner-live.json)에는 쿼리 SHA-256·고정 project ref·조회 시각·read-only 표시를 보존했다. 대상은 `hutqsfftioxtredcjhsy`, 실제 조회 역할은 `supabase_read_only_user`다. HTTP201은 조회 API 응답이며 객체 생성의 근거가 아니다.

| 대상 | 실제 관측 |
|---|---|
| 설치 후보 `postgres` | 존재·로그인 가능·상속 사용, superuser=false, BYPASSRLS=true |
| 생성 권한 | 현재 DB CREATE, public USAGE/CREATE, auth USAGE, plpgsql USAGE |
| 필수 Auth 컬럼 | sessions.id/user_id/not_after 및 users.id/banned_until/deleted_at 모두 SELECT 가능 |
| Auth users/sessions | 소유자 supabase_auth_admin, RLS=true, FORCE RLS=false, 후보의 소유자 권한 없음 |
| anon/authenticated | superuser=false, BYPASSRLS=false, public CREATE=false |
| service_role | superuser=false, BYPASSRLS=true, public CREATE=false |
| 물리 DB 크기 | 10,917,555 bytes. 공식 과금/잔여량과 동일하다고 간주하지 않음 |

실제 `postgres`는 넓은 관리 권한을 가진 기존 역할이다. 이를 최소 권한 역할이라고 표현하지 않는다. 이번 조회는 묶음에 필요한 핵심 권한의 충족 여부를 확인한 것으로, 실제 연결에서 DDL을 실행할 수 있는 토큰/비밀번호를 시험하지 않았다. 클라이언트에 이 역할이나 service-role 키를 배포하지 않는다.

## 로컬 검증과 한계

PostgreSQL17.11에서 별도 `wjb_bundle_executor` 역할을 만들고 NOSUPERUSER/NOCREATEDB/NOCREATEROLE, DB CREATE·public 생성·Auth6개 컬럼 SELECT만 부여했다. Auth fixture에는 RLS를 켰다. 이는 운영 역할 전체 ACL 복제나 실제 Supabase 인증 시험이 아니다.

- BYPASSRLS가 없으면 설치 자체는 가능하지만 Auth 행을 읽지 못해 세션 guard가 false로 차단되는 것을 확인했다.
- 로컬 관리자만 BYPASSRLS를 추가한 뒤 서버 RPC가 정상 동작하고 정확한 ACL/RLS 검증값을 유지했다. 이 ALTER ROLE은 로컬 시험에만 있으며 원격 요청/생성 묶음에 포함하지 않는다.
- BYPASSRLS가 있어도 허가하지 않은 Auth 컬럼 조회·Auth UPDATE·역할 생성은 거절됐다. 따라서 RLS 우회와 SQL ACL을 구분해 검증했다.
- 같은 비 superuser 소유자로 pause/명시적 resume/빈 설치 제거가 가능하고 Auth fixture 내용이 보존됐다.

SQL은 기존 최소 명령39개 + 전체 묶음34개 + 역할 재현13개 = **86개 통과**다. 오프라인 검토 도구는 대상·시각·권한·RLS 변경 시 거절하는 **15개 시험을 통과**했다. [SQL 증거](evidence/sql-owner-sql-pass.json), [시험 로그](evidence/sql-owner-sql-pass.txt), [검토 결과](evidence/sql-owner-review.json), [단위 시험 로그](evidence/sql-owner-unit-pass.txt)를 보존한다. 과거 HTTP/JWT 시험은 이번 수치에 중복 합산하지 않는다.

```sh
node poc/v2-cloud/owner-review.test.mjs
node poc/v2-cloud/owner-review.mjs docs/v2-design/evidence/sql-owner-live.json
PYTHONDONTWRITEBYTECODE=1 python3 poc/v2-postgres/run-local.py --bundle --owner
```

검토 도구는 신선한 관측과 manifest hash를 대조할 재료를 제공하고 `TECHNICALLY_REVIEWED`만 반환한다. 관측 JSON의 진위를 인증하거나 실제 역할로 로그인하지 않는다. `writeCredentialVerified=false`, `installationAuthorized=false`를 항상 구분해서 기록한다. 증거는 24시간을 넘으면 재조회해야 하므로 과거 증거를 실행할 때 재검토 상태로 돌아갈 수 있다.

## 다음 단계와 적용 경계

SQL 설치 단계는 여전히 **BLOCKED / autoApply=false**다. 공식 DB 한도/잔여량 확인, 정확한 묶음/rollback 최종 검토, 실제 DB-only 설치 여부 결정이 남았다. Database Size 한도500MB 여부는 사용자에게 확인을 요청했으며 아직 답변이 없어 추정 잔여량을 공식 관측으로 기록하지 않았다. Storage/Egress 잔여량과 gateway/private Storage 실검증은 후속 cloud-validation 단계 조건이다.

다음은 이 조건들을 충족한 뒤 **DB-only 묶음의 실제 적용 범위를 확정**하는 단계다. 설치 SQL은 버킷·사용자·seed·파일 전송·Keep Alive·SMTP·gateway 배포를 생성하지 않는다. 현재까지 실제 클라우드 DDL/DML·역할 변경·앱 통합·main 반영·환경 게시는 수행하지 않았다.
