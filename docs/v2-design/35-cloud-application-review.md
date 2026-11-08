# 35. 클라우드 적용 검토 묶음·인증/저장소·복구 절차

2026-11-08 · `v2-design` · 대상 `hutqsfftioxtredcjhsy` · 월0원

**후속:** HTTP gateway/Storage REST 계약 구현과 로컬61개 시험은 [36문서](36-http-gateway-storage-results.md)를 따른다. 실제 영속 metadata/Storage 검증은 남아 있다.

## 이번 진행

사용자의 커밋/푸시 후 다음 단계 요청으로 `1e8cd16`의 원격 반영을 확인하고 적용 검토 묶음을 준비했다. [파일 안내](../../poc/v2-cloud/README.md)에 대상/범위 manifest, 사전 확인 SQL, C1 세션 guard 후보 SQL, 수동 rollback, 준비 상태 도구와 시험을 모았다. **실제 Supabase에는 SQL·버킷·함수·사용자·배포를 적용하지 않았다.**

| 이번 검증 | 결과 |
|---|---|
| 준비 상태 도구 |23개 시험 성공. 미확인·과거/미래 관측·범위 확대·공개 bucket·유료·잔여량 부족 거절 |
| 서버 세션 어댑터 |11개 시험 성공. 고정 RPC·검증 principal만 전달, true 외 응답/오류는 거절 |
| 기존 JWT 검증 |28개 회귀시험 성공 |
| PostgreSQL |127개 성공 = 기존88 + C1 후보/권한/로그아웃/복구39 |
| 현재 준비 판정 | **BLOCKED**. Usage·실제 Auth 스키마/소유자·gateway/Storage·복구 검토 미완료 |

[실행 증거](evidence/cloud-review-pass.json)와 [SQL 증거](evidence/local-cloud-candidate-pass.json)에 소스/manifest hash와 결과를 기록한다. 로컬 가상 키/세션을 쓴 결과이며 실제 Auth 로그인·PostgREST·Storage와의 통합 통과가 아니다. P01~P22 전체 판정은 유지한다.

## 공식 Auth 동작과 실제 프로젝트 확인

공식 `supabase/auth` 고정 커밋 **35307ce6c1ca59016fd820f1d77d9b6201dc2e15**의 다음을 확인했다.

- [sessions 모델](https://github.com/supabase/auth/blob/35307ce6c1ca59016fd820f1d77d9b6201dc2e15/internal/models/sessions.go): subject/session, not_after, timebox/inactivity/single-session 검증과 로그아웃 시 세션 DELETE.
- [logout endpoint](https://github.com/supabase/auth/blob/35307ce6c1ca59016fd820f1d77d9b6201dc2e15/internal/api/logout.go): local/global/others 범위별 세션 제거.
- [세션 생성 migration](https://github.com/supabase/auth/blob/35307ce6c1ca59016fd820f1d77d9b6201dc2e15/migrations/20220811173540_add_sessions_table.up.sql)·[not_after migration](https://github.com/supabase/auth/blob/35307ce6c1ca59016fd820f1d77d9b6201dc2e15/migrations/20221114143122_add_session_not_after_column.up.sql).
- [users 모델](https://github.com/supabase/auth/blob/35307ce6c1ca59016fd820f1d77d9b6201dc2e15/internal/models/user.go): banned_until/deleted_at.

대상 프로젝트 Auth config를 GET으로 읽어 `sessions_timebox=0`, `sessions_inactivity_timeout=0`, `sessions_single_per_user=false`를 확인했다. 비밀 필드는 출력/저장하지 않았다. [관측값](../../poc/v2-cloud/observations.current.json)에 조회 후 파일 기록 시각과 정책만 반영했다. 이 확인은 실제 DB 컬럼이나 실행 중 Auth 서버의 소스 버전 확인을 대신하지 않는다.

현재 조건에서 C1은 검증된 JWT의 subject/session에 대해 실제 세션 행·사용자 존재, not_after, ban/soft delete, 앱 회수 장부를 확인한다. Auth 정책이 바뀌면 이 guard만으로 inactivity/timebox/단일 세션 상태를 전부 재현할 수 없으므로 배포 전/운영 변경 시 검토한다. `/user` 성공을 세션 활성 확인의 대체로 쓰지 않는다.

## 적용 범위와 단계

| 단계 | 구체 작업 | 현재 상태 |
|---|---|---|
| C0 | 대상 ref/Free·Usage·Auth 정책/스키마·migration 소유자·이름 충돌 확인 | ref/Free/도쿄/세션 정책 확인, 나머지 미확인 |
| C1 | 새 `wjb_v2_cloud.blocked_session`, private guard/revoke 및 서버 전용 public RPC2개 | 후보 SQL·로컬 검증 완료. 미적용 |
| C2 | 새 private `wjb-v2-poc-private` bucket, 서버 proxy와 예약/확정 메타데이터 | 설계 단계. 실제 API/Storage 정책 시험 미완료 |
| C3 | JWT/JWKS·세션 guard를 사용하는 HTTP gateway와 API 계약 | 순수 어댑터·가상 토큰→로컬 SQL 확인 완료. 배포 transport/HTTP 미완료 |
| C4 | 가상2계정/2공간·각4KiB 이하 자산1개로 클라우드 차단/왕복 시험 | 미실행 |

기존 `wjb_v2` 로컬 실험 스키마 전체나 bytea 자산 테이블을 클라우드에 올리지 않는다. C1만으로 업무 명령/동기화가 제공되는 것도 아니다. 유료 branch/compute/PITR·도메인 구매·SMTP 가입·Auth Site URL 변경·Keep Alive 설치는 이 묶음에 포함하지 않는다.

## C1 권한과 인증 연결

private schema와 고정 search_path 함수를 만들고, public wrapper는 SECURITY INVOKER로 두되 service-role만 실행할 수 있게 한다. anon/authenticated의 public RPC·private 함수·회수 테이블 접근을 거절한다. 클라이언트가 지정한 userId/sessionId를 RPC에 보내지 않고, `jose` 검증 결과만 [세션 어댑터](../../poc/v2-auth/session-adapter.mjs)에 넘긴다. 어댑터는 고정 RPC명과 두 UUID만 전달하고 scalar true만 수락한다. 실제 server transport와 서버 전용 credential은 아직 연결하지 않았다.

private definer 함수는 적용한 migration 역할이 소유한다. 로컬 시험의 postgres는 높은 권한을 가진 역할이므로 ‘최소 권한 소유자 검증 완료’라고 부르지 않는다. 대상 역할이 Auth를 읽을 수 있는지, definer의 넓은 권한을 고정 SQL/한정된 반환값/실행 ACL로 제한했는지 실제 환경에서 검토해야 한다. Auth 관리 테이블에 DML이나 정책을 추가하지 않는다. 현재 후보의 사전 컬럼 검사도 접근 불가/스키마 불일치 시 변경 없이 거절한다.

등록된 앱 세션 회수는 제공자의 logout과 별도다. C1은 provider session이 삭제되어도, 앱 장부에 차단되어도 false를 반환한다. SQL/HTTP 오류·unknown kid·비정상 RPC 응답은 통과시키지 않는다. 요청 중 세션 회수가 발생하면 이미 진행 중인 작업이 완료될 수 있고, 이미 받은 파일을 서버에서 회수할 수는 없다. 쓰기 수락 트랜잭션의 최종 권한 확인과 동시 회수 경합은 실제 gateway/업무 API 통합 단계에서 추가 검증한다.

## C2 비공개 저장소·전송 계약

초기 표본은 signed upload/download URL 대신 **서버 proxy**를 사용한다. private bucket만으로 모든 접근이 차단되는 것은 아니므로 기존 Storage 정책이 대상 bucket을 허용하는지도 검사해야 한다. public=false, 직접 anon/authenticated 읽기·쓰기·목록 불가, server-only 경로를 실제 두 계정으로 검증한다. Storage managed 테이블을 SQL로 직접 고치지 않고 지원되는 Storage API로 bucket/객체를 다룬다. 같은 이름의 기존 bucket이 있으면 재사용/수정하지 않고 멈춘다.

서버가 생성하는 경로는 `<workspace UUID>/<asset UUID>`이며 사용자 파일명/상대 경로를 받지 않는다. 업로드 요청의 principal→공간 소유권/기기/generation→용량 예약→제한된 bytes 읽기→크기/hash 검증→비공개 객체 저장(upsert=false)→ready 확정 순서다. 서버가 workspace와 asset 메타데이터의 결합을 검증한다. 예약/부분 파일은 다운로드하지 않는다. 완료 응답 유실은 같은 자산 ID/hash로 결과를 확인하고 덮어쓰지 않는다.

다운로드도 매번 현재 세션·공간·generation·ready를 확인한 뒤 proxy로 전달한다. 이 경로는 장기 signed URL의 잔여 접근 창을 피하지만 진행 중 전송/이미 내려받은 사본을 회수하지는 않는다. proxy는 대역폭/함수 요청을 추가하므로 실제 egress/호출량을 계측해야 한다. 큰 파일을 한 번에 메모리로 읽는 기본 운영안으로 확장하지 않는다.

DB와 Storage는 단일 트랜잭션이 아니다. 객체 저장 성공/DB 확정 실패 시 private pending 상태로 유지하고, 재확인으로 ready 또는 명시적 취소를 수행한다. 객체 DELETE 실패 시 취소 완료/용량 반환으로 처리하지 않고 정리 대기로 보존한다. 실제 Storage로 이 순서·장애·GC를 검증한 뒤에만 `privateStorageVerified`를 true로 기록한다.

## 무료 비용·시험 자료

사용자 확인 Free와 월0원 원칙을 유지한다. 준비 입력은 DB(프로젝트), Storage/Egress(조직 합산)의 실제 잔여량과24시간 이내 관측 시각이 필요하다. 현재 수치를 모르는 상태를0사용/충분으로 바꾸지 않는다. 점검 도구의 여유 기준(DB10MiB·Storage1MiB·Egress10MiB)은 아주 작은 PoC용 보수적 관문이며 무료 할당량이나 제품 quota가 아니다. 과금 방지 장치/SLA로 해석하지 않는다.

확정할 최초 실측은 계정2·공간2·자산2×최대4KiB, 1회 정상 왕복과 차단/재시도다. 이미지 품질이 아닌 임의 bytes 저장/해시 시험부터 수행한다. 계정 생성이 필요하면 승인 범위 내 시험 전용 ID와 발송 없는 절차를 먼저 고정하고 기존 계정을 재사용/삭제하지 않는다. 기본 SMTP 제한을 우회하는 가입 출시안으로 쓰지 않는다. 비밀번호/토큰/자료는 Git에 넣지 않고 생성된 리소스 ID와 hash만 별도 운영 기록에 남긴다.

## 수동 복구·중단 순서

1. 현재 gateway/API를 먼저 차단하고 업로드/다운로드/명령 트래픽이 없는지 확인한다. 로컬 원본은 계속 보존한다.
2. 서비스가 쓰이기 시작했다면 회수 장부·시험 자산 manifest를 Git 밖의 안전한 위치에 보존한다. 장부 제거 뒤 서비스를 그대로 재개하면 기존 토큰 차단이 사라질 수 있으므로 복구 전 재인증/차단 유지 방안을 정한다.
3. C2를 실행한 경우 기록된 시험 객체 ID만 Storage API로 삭제하고 실제 객체 삭제를 확인한다. 기존/다른 경로·버킷은 건드리지 않는다. 전용 bucket도 비어 있고 이번 실행이 생성한 것이 확인된 경우에만 제거한다.
4. C1 제거가 필요하면 확인 표시 `wjb.confirm_cloud_rollback='hutqsfftioxtredcjhsy:no-active-traffic'`를 설정한 **동일 SQL 연결**에서 rollback 파일을 수동 실행한다. 표시는 인간의 절차 확인용이고 프로젝트 연결/권한 보증이 아니다. 파일은 알려진 객체만 순서대로 제거하며 CASCADE를 쓰지 않는다. 예상 밖 의존성이 있으면 전체 트랜잭션을 취소한다.
5. Auth의 실제 시험 사용자 정리는 생성 manifest의 ID만 지원 API로 처리한다. Auth/Storage 관리 테이블을 직접 DELETE하는 복구 스크립트는 제공하지 않는다. 기존 Auth/업무 데이터와 schema가 유지됐는지 확인한다.

로컬 시험에서 확인 표시 없는 rollback 거절, 예상 밖 schema 의존성에 의한 전체 rollback, 명시적 제거 성공, Auth fixture/이전 업무 보존을 확인했다. 이 결과는 실제 클라우드 복구 연습이 아니다.

## 현재 결론과 다음 작업

적용 검토 파일과 로컬 SQL/어댑터·준비 검사가 갖춰졌다. 현재 preflight는 BLOCKED가 맞으며 설정값을 임의로 true로 채워 진행하지 않는다. 입력 JSON은 운영자의 확인 기록일 뿐 실제 계정 조회/권한 검증을 대체하지 않는다. 다음은 **HTTP gateway/실제 Storage 어댑터의 구현·로컬 장애 시험**, 이어서 대상 스키마/소유자·Usage 확인과 작은 클라우드 적용 범위 검토다. 환경 설정 재적용/게시·main 병합·제품 판올림/빌드는 수행하지 않았다.
