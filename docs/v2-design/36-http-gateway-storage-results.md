# 36. HTTP gateway·Storage REST 계약 구현과 로컬 장애 시험

2026-11-08 · `v2-design` · 앱1.23.0 / DB18 유지

## 진행 결과

사용자의 커밋/푸시 후 다음 진행 요청으로 `31b85e4`의 원격 반영을 확인한 뒤 [독립 gateway PoC](../../poc/v2-gateway/README.md)를 구현했다. **실제 로컬 HTTP 서버2개를 사용하는61개 시험이 통과**했다. 하나는 gateway, 다른 하나는 Supabase 형태의 시험 REST 서버다. 실제 Supabase Auth/Storage나 영속 PostgreSQL과 한 흐름으로 연결한 시험은 아니다.

[실행 증거](evidence/http-gateway-pass.json)에61개 이름/결과·코드/의존성 hash·원시 로그 hash를 기록했다. [최종 로그](evidence/http-gateway-pass.txt)도 보존한다. 최초 샌드박스 실행은127.0.0.1 listen의 EPERM으로 실패했고 지원되는 외부 실행 경로에서 성공했다. 이는 gateway 코드 실패나 실제 Supabase 연결 실패로 기록하지 않는다.

| 묶음 | 확인한 동작 |
|---|---|
| HTTP 인증 | 가상 ES256 서명→고정 server RPC→세션 상태 확인, 잘못된 토큰/회수/상류 오류 거절 |
| 입력 경계 | body의 userId/path 추가 거절, UUID·bigint 문자열·크기/길이·content type·query/Origin/메서드 제한 |
| 업로드/다운로드 | 예약→실제 bytes/hash 확인→immutable 저장→ready, ready만 본문 반환, 다른 계정/기기 쓰기 거절 |
| 전달 중 권한 | 저장/다운로드 이후 세션과 generation을 다시 확인. 회수/변경이면 ready/응답 거절 |
| 재시도 | Storage 저장 후 ack 유실·동일 private bytes 확인, 다른 bytes 덮어쓰기 금지, DB 확정 실패/ack 유실 구분 |
| 취소/용량 | pending→cleanup→객체 부재 확인→canceled, 삭제/확정 실패 또는 회수 시 quota 유지, ready 삭제 금지 |
| 경쟁/보호 | 동시 업로드1회 저장, quota 초과 방지, 취소/업로드 직렬화, chunked 실제 HTTP 크기 제한 |
| 상류/오류 | 서비스 키 비노출, redirect 미추적, 고정 목적지/RPC·경로, 큰 응답/느린 body 취소, 원래 오류 상세 비노출 |

## HTTP 계약

공통 경로는 `/v2/workspaces/<workspace UUID>/assets/<asset UUID>/…`이며 모든 요청에 Bearer가 필요하다. client가 지정한 userId/sessionId/role을 데이터 소유권으로 사용하지 않는다. principal은 기존 Auth 검증기에서만 받는다.

| 요청 | 입력 | 결과 |
|---|---|---|
| `POST …/reserve` | JSON `deviceId, generation, sha256, bytes` | 새 예약201, 같은 예약 재시도200 |
| `PUT …/content` | octet-stream, `x-wjb-device-id`, `x-wjb-generation` | hash/크기 확인 후 저장·확정, ready200 |
| `GET …/content` | 같은 두 scope header | ready bytes만 attachment/no-store로 반환 |
| `POST …/cancel` | JSON `deviceId, generation` | cleanup 및 객체 부재 확인 후 canceled200 |

generation은 양의 bigint 십진 문자열이다. 파일64KiB·JSON2KiB·body 읽기5초/상류 요청5초는 작은 PoC 제한이며 제품/무료 요금제 한도가 아니다. 다운로드도 작은 payload 전체를 제한 내에서 읽고 검증한 뒤 반환한다. 큰 파일과 Edge Functions의 실행/메모리 제한에 맞춘 streaming 설계는 별도다.

Origin은 기본 거절하고 CORS/cookie/native callback 경로를 추가하지 않았다. Node host는 명시적으로 listen하는 로컬 시험용이며 생산용 배포 entrypoint가 아니다. 현재 앱의 CSP·외부 통신 정책은 변경하지 않았다.

## Storage/RPC 어댑터와 공식 근거

대상은 `hutqsfftioxtredcjhsy.supabase.co`, bucket은 `wjb-v2-poc-private`로 고정한다. 서버가 검증한 workspace/asset UUID로만 경로를 만들고 URL/파일명을 client에게 받지 않는다. 서비스 키는 transport 내부 header에만 쓰며 사용자 Bearer를 Storage 권한으로 대체하지 않는다. 현재 시험에는 가상 키만 사용했고 실제 비밀을 읽지 않았다.

공식 `supabase/storage` 커밋 **6bb2e4c360767bef715955e2ba25dfc45c0f0af7**의 다음 경로/인자를 확인했다([근거 기록](evidence/storage-rest-source.json)). 이는 대상 프로젝트에서 실행 중인 Storage 버전 확인을 대신하지 않는다.

- [createObject](https://github.com/supabase/storage/blob/6bb2e4c360767bef715955e2ba25dfc45c0f0af7/src/http/routes/object/createObject.ts): object POST·`x-upsert`.
- [getObject](https://github.com/supabase/storage/blob/6bb2e4c360767bef715955e2ba25dfc45c0f0af7/src/http/routes/object/getObject.ts): authenticated object GET.
- [deleteObjects](https://github.com/supabase/storage/blob/6bb2e4c360767bef715955e2ba25dfc45c0f0af7/src/http/routes/object/deleteObjects.ts): bucket DELETE·prefixes 배열.

구현은 `POST /storage/v1/object/<bucket>/<path>`에 upsert=false, 인증 GET에 고정 경로, DELETE에 정확한 단일 object prefix만 사용한다. redirect는 error로 처리한다. 중복 객체 응답은 기존 bytes를 다시 읽어 기대 hash/크기와 같을 때만 재확정할 수 있다. DELETE2xx만으로 완료하지 않고 인증 GET404로 부재를 확인한다. 상류의 오류 상세는 고객에게 전달하지 않는다.

세션 RPC는 `/rest/v1/rpc/wjb_v2_session_active` 하나만 허용하며 검증된 principal의 두 UUID를 전달한다. boolean true만 활성으로 취급한다. 서버 transport는 설정에서 명시적으로 주입해야 하고 자동으로 환경 키를 읽거나 운영 host에 접속하지 않는다. 시험 transport는 URL이 고정 Supabase origin인지 검증한 후127.0.0.1 서버로만 전달했다.

## 복합 실패와 상태

객체 저장 뒤 ready 확정이 실패하면 private reserved와 quota를 유지한다. 재시도는 upsert하지 않고 같은 bytes인지 확인한다. ready가 commit됐으나 응답만 유실되면 기존 ready 결과를 반환한다. 전송 후 토큰이 회수되거나 generation/예약 만료가 바뀌면 새 ready를 게시하지 않는다. 다운로드 전 재검사로 회수/변경을 확인하면 bytes를 반환하지 않는다. 재검사 직후의 진행 중 작업과 이미 받은 파일까지 되돌릴 수 있다는 보장은 아니다.

취소는 먼저 cleanup 상태로 숨기고 객체 삭제를 요청한다. 삭제 실패·DELETE2xx 후 객체 잔존·취소 메타데이터 실패·세션 회수에는 quota를 반환하지 않는다. 같은 취소를 다시 시도할 수 있지만 회수된 creator의 정리나 generation 변경 후 orphan 정리는 권한 있는 별도 worker가 필요하다. ready 삭제/실제 GC·보관본 참조는 이번 기능에 포함하지 않는다.

## 중요한 구현 한계

`fixtures.mjs`는 **메모리 metadata와 단일 프로세스 잠금**이다. scope/세션·기기·generation·expiry·quota·fault injection을 시험하지만 서버 재시작·다중 서버·SQL 트랜잭션·lease 만료/fencing을 보장하지 않는다. 이 구현을 실제 gateway의 영속 저장소로 사용하면 안 된다. Storage 시험 서버도 API 형태의 대체 구현이며 실제 bucket RLS·Supabase 응답/일관성·요청량/egress를 측정하지 않았다.

기존 PostgreSQL127개와 이번 HTTP61개는 서로 다른 경계의 증거다. SQL 함수/RPC와 metadata 어댑터를 하나의 실제 gateway 흐름으로 연결하는 시험이 다음이다. 기존 SQL/검증기 구현은 변경하지 않았고 해당127개/28개를 이 단계에서 무의미하게 합산·재실행하지 않았다. Auth PoC에 추가한 파일은 의존 패키지 공용 API의 테스트 재노출뿐이며 제품 dependency/lockfile은 유지한다.

실제 DB·Storage 미검증이므로 readiness의 `gatewayVerified`/`privateStorageVerified`를 true로 올리지 않았다. Usage 잔여량 미확인도 유지한다. 환경 설정 게시·클라우드 쓰기·main 병합·제품 판올림/빌드는 하지 않았다.

## 다음 단계

PostgreSQL 메타데이터 adapter를 구현해 실제 reservation/상태·quota·lease/fence를 영속화하고, **gateway HTTP→SQL→Storage 대체 서버**의 통합/프로세스 종료·재시작 시험을 진행한다. 그 뒤 대상 프로젝트의 SQL 스키마/실행 소유자·private bucket 정책·Usage를 확인한 작은 적용 범위를 검토한다.
