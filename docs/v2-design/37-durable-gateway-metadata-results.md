# 37. PostgreSQL 영속 메타데이터·gateway 재시작·경합 시험

2026-11-08 · `v2-design` · 앱1.23.0 / DB18 유지

## 이번 구현

사용자의 커밋/푸시 후 다음 진행 요청으로 `8091f85`의 원격 반영을 확인한 뒤, 메모리 fixture와 별개인 PostgreSQL metadata adapter를 추가했다. **gateway HTTP → 가상 PostgREST 형태 서버 → 실제 PostgreSQL → Storage 형태 대체 서버**의 로컬 흐름을 연결했다. 실제 Supabase에는 적용하지 않았다.

| 구현 | 파일/역할 |
|---|---|
| 영속 schema/명령 | [postgres-metadata.sql](../../poc/v2-gateway/postgres-metadata.sql) — workspace/device/asset/io_intent, 서버 전용 command RPC |
| metadata adapter | [postgres-metadata.mjs](../../poc/v2-gateway/postgres-metadata.mjs) — 예약·lease·상태·I/O 기록·반환 검증 |
| gateway/REST 연결 | 기존 gateway에 I/O 시작/확정 hook, 고정 metadata RPC/오류 allowlist 추가 |
| 별도 실행 프로세스 | [durable-worker.mjs](../../poc/v2-gateway/durable-worker.mjs) — 명시적 IPC 설정으로만 로컬 gateway 실행 |
| 통합 시험 | [durable.test.mjs](../../poc/v2-gateway/durable.test.mjs) — Docker PostgreSQL·두 gateway 프로세스·장애 주입 |

**최종 결과:** 영속 통합25개, metadata adapter12개, 영향받은 기존 HTTP61개가 모두 통과했다([실행 증거](evidence/durable-gateway-pass.json), [통합 로그](evidence/durable-gateway-pass.txt)). 서로 다른 범위이며 기존 P01~P22 전체 환경 통과로 합산하지 않는다.

## 메모리 fixture에서 달라진 점

예약 용량과 자산 상태는 PostgreSQL에 기록한다. workspace 행 잠금 안에서 신규 예약/용량 증가를 함께 처리하고, 취소 확정/용량 감소도 함께 commit한다. 예약 삽입이 실패하면 선행 용량 증가도 rollback된다. 재시작 후 같은 예약의 재시도는 다시 과금하지 않는다.

네트워크 I/O 동안 DB 트랜잭션/연결을 붙잡지 않는다. 짧은 SQL 명령으로30초 lease와 증가하는 fence를 발급한다. 현재 lease의 token/fence/만료를 매 상태 변경마다 확인하고 새 작업이 소유권을 얻으면 이전 작업의 게시/해제를 거절하거나 무효화한다. lease가 사용 중이면 LEASE_BUSY 충돌을 반환하며 클라이언트 자동 재시도 UX는 아직 없다. 긴 전송의 lease 갱신은 구현하지 않았고, PoC 파일64KiB·읽기/상류5초 제한에 한정한다.

SQL 안에서도 현재 provider/app 세션·device binding/회수·소유 공간·generation을 확인한다. client role은 command RPC/테이블을 직접 사용할 수 없다. server-only RPC는 gateway가 검증한 principal에서 만든 인자를 받는다. private definer 함수는 로컬 migration 역할의 높은 권한으로 실행되므로 실제 배포 소유자/ACL 검토가 여전히 필요하다.

## 늦은 저장과 미확정 요청

lease 만료는 이미 발행한 Storage 요청이 끝났다는 증거가 아니다. 이 차이를 무시하면 이전 작업이 취소/삭제 뒤에 파일을 다시 만들어 용량이 잘못 반환될 수 있다.

gateway는 Storage 쓰기 전에 intent를 DB에 남기고, 성공 또는 중복 응답이 확인됐을 때 같은 intent를 확정한다. 불명확한 오류/프로세스 종료에는 미확정 상태로 둔다. 늦게 도착한 확정은 예전 lease라도 해당 요청의 **기록 정리만** 할 수 있으며 ready 등 사용자 상태를 게시할 수 없다.

자산 ID와 기대 hash/크기는 바뀌지 않고 객체 upsert도 하지 않는다. 새 작업이 같은 private 객체를 확인해 ready로 재확정하는 것은 가능하다. ready는 용량을 계속 점유하고 이 단계에서 취소/삭제하지 않는다. 자산 ID 재사용·식별자 기록의 물리 삭제도 허용하지 않아 늦은 쓰기가 다른 새 자료를 덮어쓰지 않게 한다.

취소는 cleanup으로 전환하고 객체 삭제/부재를 확인한다. SQL이 마지막으로 다음 둘을 확인해야 canceled/용량 반환이 가능하다.

1. 미확정 I/O intent가 없어야 한다.
2. cleanup 시작 때 보았던 `io_version`이 그대로여야 한다. 이후 저장 요청 확정이 도착했다면 부재 관측이 낡았을 수 있으므로 CLEANUP_CHANGED로 거절하고 다시 삭제/확인을 요구한다.

파일이 현재 안 보인다는 이유만으로 미확정 intent를 정리하지 않는다. 프로세스가 종료돼 영구히 ack를 못 받은 요청은 CLEANUP_UNCERTAIN으로 남을 수 있고 용량도 계속 예약된다. **이 경우를 자동 복구 완료라고 부르지 않는다.** 실제 저장소의 완료/정리 증거를 확인하는 worker·운영자 절차는 후속이다. 잘못 용량을 반환하는 것보다 보수적인 중단을 선택한다.

PoC는 공간당 식별자 기록256개(취소 ID 포함), 자산당 I/O intent64개로 메타데이터 증가도 제한했다. 파일64KiB·공간1MiB·예약5분과 함께 시험용 값이며 제품 quota/무료 제공 한도로 확정한 것이 아니다.

## 실제 수행한 장애·경합 시험

| 상황 | 확인 |
|---|---|
| gateway SIGKILL 후 새 프로세스 | ready/예약·quota 유지, 정상 다운로드/예약 재시도 |
| PostgreSQL 컨테이너 재시작 | 같은 전용 volume의 metadata/quota 유지 |
| gateway2개 동시 upload/reserve | 동일 write lease 중복 불가·quota 원자적 제한 |
| 이전 worker가 lease 만료 뒤 완료 | 새 lease/ready를 지우거나 과거 상태를 게시하지 못함 |
| cleanup 뒤 이전 저장 도착 | 취소 확정/용량 반환 거절, 늦은 확정 뒤 재삭제/취소 가능 |
| 객체 저장 직후 SIGKILL | private reserved와 intent 보존, 같은 immutable 객체로 ready 재시도 |
| intent 기록 후 저장 전 SIGKILL | 객체가 없어도 취소 확정/용량 반환을 추측하지 않음 |
| provider logout/generation 변경 | HTTP 및 SQL 최종 게시 거절 |
| SQL ready/예약 실패·ready 응답 유실 | 해당 SQL 명령의 변경은 rollback, 이미 commit된 결과는 재사용. Storage/I/O 기록은 별도 보존 |
| Storage 삭제 실패 후 gateway 재시작 | cleanup/quota 유지 후 재시도 성공 |
| cleanup 관측 이후 늦은 intent 확정 | epoch 불일치로 용량 반환 거절 |
| 불완전 lease 값·취소 ID 재사용 | DB 제약/명령으로 거절, 기존 상태/용량 보존 |

lease 경합/재시작 시험의 만료 전환은 이전 프로세스 종료 또는 pause를 확인한 뒤 로컬 관리자가 시간을 앞당긴 fixture다. 실제30초를 기다린 성능/TTL 보장 시험은 아니다. gateway 종료는 실제 SIGKILL이고 PostgreSQL은 실제 컨테이너 재시작이다. 전원 장애·호스트 재시작/파일시스템 손상·다중 리전 내구성을 확인한 것은 아니다.

## 환경과 검증 경계

공식 고정 PostgreSQL17 이미지, 네트워크 none/공개 포트 없음/Unix socket, 메모리512MiB·CPU1의 전용 컨테이너를 썼다. 재시작 검증용 이름 있는 volume은 실행별 임의 ID와 label로 식별하고 테스트 종료 때 자기 컨테이너/volume만 검증 후 제거했다. 전역 prune/다른 자료 삭제는 하지 않았다. gateway/대체 서버는127.0.0.1만 사용하고 실제 Supabase credential을 테스트 환경에서 제거했다.

Auth 테이블은 공식 구조 일부를 따른 로컬 fixture이며 실제 managed Auth가 아니다. C1 session guard SQL은 실제로 설치해 가상 서명→HTTP RPC→실제 SQL 확인 경로를 시험했다. provider REST/Storage 서버 자체는 대체 구현이고 Storage 객체는 테스트 부모 프로세스 메모리에 있다. gateway/PostgreSQL 재시작 중 부모 서버를 살려 두었으므로 **실제 객체 저장소의 내구성·PostgREST 동작·bucket RLS·클라우드 egress를 확인한 것이 아니다.**

기존61개 HTTP 시험도 회귀했고 metadata adapter의 알려진/알 수 없는 오류·잘못된 scope 응답·lease 해제·I/O 인자·cleanup epoch 전달12개를 확인했다. 현재 바꾸지 않은 기존 SQL127개/SQLite214개를 다시 합산하거나 실행하지 않았다. 제품 dependency/lockfile·앱/DB18·main·클라우드 준비 true flag는 유지한다.

## 다음 단계

미확정 intent를 다루는 **보수적 복구 worker/운영자 UI 계약·작업 보존/해제 조건**을 먼저 구체화하고 검증한다. 이어 새 metadata schema/RPC까지 포함한 적용·되돌리기 목록과 실제 Storage 정책/Usage 확인을 준비한다. 기존 C1 적용안이 새 metadata schema까지 승인/검증한 것은 아니며, 이 SQL을 운영 프로젝트에 바로 실행하지 않는다.
