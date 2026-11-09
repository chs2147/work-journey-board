# 39. 전체 SQL 적용·권한·자료 보존형 중단/제거 묶음

`v2-design` · 실제 읽기 조회 시각은 증거 JSON 참조 · 앱1.23.0 / DB18 유지

## 결과와 검토 파일

사용자의 커밋/푸시 후 다음 단계 요청으로 `56ee078`의 원격 반영을 확인하고 세션·metadata·recovery SQL을 하나의 검토 묶음으로 정리했다. **실제 프로젝트에는 읽기 조회만 수행했다. 스키마/RPC·버킷·사용자·gateway를 생성하거나 배포하지 않았다.**

| 파일 | 검토 대상 |
|---|---|
| [manifest.json](../../poc/v2-cloud/bundle/manifest.json) | 고정 ref/리전/월0원·SQL3개·템플릿·생성기/출력 hash·전체 객체 목록 |
| [install.sql](../../poc/v2-cloud/bundle/install.sql) | schema2개·table6개·public RPC4개·private 함수3개를 한 트랜잭션으로 설치 |
| [preinstall.sql](../../poc/v2-cloud/bundle/preinstall.sql) | Auth 컬럼·충돌·전용 bucket·Storage 집계의 읽기 전용 확인 |
| [verify.sql](../../poc/v2-cloud/bundle/verify.sql) | 설치 후 RLS·EXECUTE·직접 table 접근·search_path·소유자 조회 |
| [pause.sql](../../poc/v2-cloud/bundle/pause.sql) | 자료를 남기고 service-role RPC 접근을 중지 |
| [resume.sql](../../poc/v2-cloud/bundle/resume.sql) | 검토 확인 후 원래 server-only 권한만 복구 |
| [rollback.sql](../../poc/v2-cloud/bundle/rollback.sql) | 모든 관리 테이블이 빈 경우에만 전체 제거. CASCADE/자료 purge 없음 |

**최종 로컬 검증:** 생성/전체 준비 검사29개·기존 준비 검사23개·SQL73개가 성공했다([증거](evidence/full-bundle-pass.json)). SQL73개는 기존 최소 명령39개와 전체 묶음34개다. 이전 단계의 HTTP41/61개 등을 이 작업에서 중복 합산하지 않는다.

## 실제 Supabase 읽기 점검

대상은 `hutqsfftioxtredcjhsy` 하나다. [설정 조회](evidence/full-bundle-live-config.json)와 [실제 preinstall 결과](evidence/full-bundle-live-preinstall.json)를 보존한다. config 응답은 허용 필드만 기록해 JWT secret·메일 비밀·키를 제외했다. SQL은 공식 **`POST /database/query/read-only`**에 고정 SELECT만 보냈고 실제 실행 역할은 `supabase_read_only_user`였다. 응답201은 이 조회 API의 상태이며 리소스 생성의 근거가 아니다.

| 항목 | 실제 확인 |
|---|---|
| 상태/primary region | ACTIVE_HEALTHY / ap-northeast-1 도쿄 |
| PostgreSQL |17.11 — 로컬 시험 이미지와 같은 major/minor |
| Auth 구조 | sessions.id/user_id/not_after, users.id/banned_until/deleted_at의6개 이름/타입 일치 |
| 신규 schema | wjb_v2_cloud / wjb_gateway 없음 |
| 신규 public RPC 이름 |4개 모두 기존 overload 포함 충돌 없음 |
| Data API schema | public,graphql_public. private schema 미노출 |
| 실제 물리 DB 크기 |10,917,555 bytes — 약10.9MB/10.4MiB |
| 전용 bucket | wjb-v2-poc-private 없음 |
| 프로젝트 Storage | 객체0개·metadata 크기 합계0·알 수 없는 크기0 |
| Storage 보호 | objects RLS true, 정책0개인 현재 baseline |
| 세션 정책 | timebox0·inactivity0·single-session false |
| 선택 추가상품 | 없음 |

물리 DB 크기는 공식 청구/잔여량 정의와 같다고 가정하지 않는다. 프로젝트 파일0개도 **조직 합산 Storage/Egress 사용량0**의 증거가 아니다. 따라서 실제 관측으로 Auth 구조·이름 충돌·private schema 노출 항목만 갱신했고, 공식 잔여량/실행 소유자/실제 gateway·private Storage 검증은 완료 처리하지 않았다. Free 플랜은 앞서 사용자 대시보드 확인 근거를 유지한다.

## 생성·범위 고정

```sh
node poc/v2-cloud/bundle.mjs build
node poc/v2-cloud/bundle.mjs check
```

이 명령은 로컬 파일 생성/일치 확인만 하고 SQL을 실행하지 않는다. 입력3개와 템플릿은 고정 경로이고 생성 시점 timestamp를 넣지 않아 재현 가능하다. install은 각 원본의 알려진 외곽 BEGIN/COMMIT만 제거해 하나로 감싼다. 임의 SQL을 해석하는 범용 parser가 아니며 예상하지 못한 transaction 구조는 거절한다.

check는 생성기/소스/템플릿/출력 hash와 실제 bytes를 대조한다. bundle 안에 예상 밖 SQL/JSON 파일이 있어도 거절한다. 검토 메모/별도 수정본은 generated 폴더 밖에 둔다. **bundle 폴더의 `*.sql`을 일괄 실행하면 안 된다.** 설치·중지·재개·제거는 서로 다른 선택 작업이다.

설치는 한 트랜잭션이므로 첫 schema 충돌뿐 아니라 마지막 recovery RPC 충돌도 새 모듈 전체를 rollback한다. 기존 객체를 OR REPLACE/IF NOT EXISTS로 덮거나 재사용하지 않는다. ref는 manifest/실행 연결에서 확인해야 한다. SQL의 이름/GUC 확인 문구만으로 연결한 프로젝트가 증명되는 것은 아니다.

## 권한과 범위

관리 테이블6개는 RLS를 켜고 anon/authenticated/service-role 직접 CRUD를 허용하지 않는다. anon/authenticated/PUBLIC의 함수 실행도 금지한다. server-role은 public RPC4개와 C1 invoker wrapper가 필요로 하는 private helper2개/namespace usage만 받는다. metadata private namespace는 직접 개방하지 않는다.

모든 함수의 search_path를 고정하며 실제 소유자 역할과 superuser/bypass RLS 속성은 verify 결과에 별도로 표시한다. 로컬 시험의 높은 권한 postgres를 실제 배포 소유자 검토 완료로 해석하지 않는다. 실제 조회 역할이 read-only였다는 사실도 설치를 수행할 역할/권한의 확인을 대신하지 않는다.

이 SQL 설치에는 Storage bucket/API 정책 생성, Auth 사용자·비밀번호 생성, 시험 workspace/device seed, 파일 업로드, 데이터 migration, Keep Alive, SMTP·callback 변경, gateway 배포를 포함하지 않는다. manifest의 전용 bucket/표본은 후속 실제 검증 범위이며 install.sql이 이를 생성하는 것이 아니다.

## 자료가 있을 때의 되돌리기

운영 중 문제가 생기면 외부 gateway 유입을 먼저 멈추고 진행 중 요청을 확인한 뒤 pause.sql을 검토해 service-role RPC 접근을 중지한다. 이미 시작한 요청/관리자 권한까지 즉시 중단한다는 뜻은 아니다. table/asset/미확정 intent/회수 장부/감사 기록을 삭제하지 않는다.

같은 묶음을 재개할 때는 기록·버전·권한을 검토하고 동일 SQL 연결에 다음 확인 표시를 설정한 뒤 resume.sql을 선택 실행한다.

```sql
SET wjb.confirm_bundle_resume='hutqsfftioxtredcjhsy:reviewed';
```

확인 표시는 절차 확인용이며 인증이나 대상 프로젝트 보장이 아니다. 재개는 client/PUBLIC 권한을 추가하지 않는다. 실제로 자료가 생겼다면 DROP으로 되돌리지 않고 중지/보존 상태에서 별도의 이관/복구안을 만든다.

## 빈 설치의 제거

트래픽 중지 확인 뒤에만 동일 연결에서 다음 표시와 rollback.sql을 사용한다.

```sql
SET wjb.confirm_bundle_rollback='hutqsfftioxtredcjhsy:traffic-stopped';
```

제거는 관리 테이블6개를 잠그고 **한 행이라도 있으면 BUNDLE_DATA_PRESENT로 거절**한다. workspace/device만 있어도 제거하지 않는다. 미확정 I/O·회수 장부·완료 이력을 삭제해 quota나 차단 상태를 없애지 않는다. 생성된 객체만 역순으로 제거하고 CASCADE를 쓰지 않아 예상 밖 의존성에는 전체 트랜잭션을 취소한다. Auth/Storage 관리 table이나 기존 앱 자료는 제거하지 않는다.

로컬 시험에서는 충돌 시 원래 객체 보존, pause/resume 후 자료 동일, 자료 있는 uninstall 거절, 빈 uninstall 성공, Auth/다른 앱·public/Storage 자료 보존과 재설치를 확인했다. test fixture를 되돌리기 위한 로컬 TRUNCATE/INSERT는 시험 파일에만 있고 생성 artifact/원격 조회에는 없다.

## 단계별 준비 상태

설치해야 존재하는 gateway/Storage를 설치 선행조건으로 요구하는 순환을 피하도록 단계별로 분리했다.

```sh
node poc/v2-cloud/preflight.mjs --bundle --phase=sql-install poc/v2-cloud/observations.current.json
node poc/v2-cloud/preflight.mjs --bundle poc/v2-cloud/observations.current.json
```

- **sql-install:** source/검토 hash·고정 대상/Free·실제 Auth 구조/충돌·실행 소유자·DB 잔여량·rollback 검토를 요구한다. 아직 생성하지 않는 bucket/gateway·조직 파일 traffic 검증은 deferred로 명시한다.
- **cloud-validation:** 실제 gateway/private Storage 및 조직 Storage/Egress 잔여량도 추가 요구한다.

현재 둘 다 **BLOCKED / autoApply=false**다. SQL 단계는 공식 DB 잔여량·실행 소유자와 최종 묶음/되돌리기 검토가 남았다. 현재 측정 크기를 임의로 무료 잔여량으로 바꾸거나, 로컬 시험 성공으로 cloud gateway/Storage flag를 올리지 않았다. 관측 JSON은 확인 기록이며 그 진위를 자동 인증하는 시스템이 아니다. 모든 항목이 충족돼도 REVIEW_READY만 반환하고 적용하지 않는다.

## 다음 진행

실행할 역할/권한과 공식 DB 잔여량을 확인하고, 이 **DB-only 설치 범위**를 검토한 뒤 실제 적용 여부를 결정한다. 후속 단계의 버킷·시험 계정/공간·파일 전송·gateway는 별도 범위다. 제품 코드/DB18·main·배포·환경 설정 게시·실제 클라우드 DDL/DML은 변경하지 않았다.

후속 실행 역할 기술 검토와 비 superuser 재현 시험은 [40문서](40-sql-executor-review.md)에 기록했다. 위 표/판정은 이 문서를 작성한 시점의 관측이며, 최신 준비 상태는 observations.current.json과 40문서를 함께 확인한다.
