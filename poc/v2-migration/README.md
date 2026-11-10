# 온라인 사본 이관의 영속 journal PoC

```sh
node poc/v2-migration/coordinator.test.mjs
```

합성 DB18→별도 metadata/이미지 파일 사본→작업 journal→테스트 서버 port 흐름을 검증한다. journal은 ID/hash/정수 크기/상태만 저장하며 이미지 본문/인증 키를 넣지 않는다. 원본 로컬 폴더와 겹치는 위치/기존 DB18/alias를 쓰기용으로 열지 않는다.

원격 port는 trusted adapter 계약이며 실제 Supabase migration RPC가 아니다. observe의 operationSettled를 단순 HEAD/timeout에서 추측하지 않는다. publish/cancelStaging은 실제 서버에서 원자적으로 구현해야 한다. 취소/기게시 재조회는 파일 유실 시에도 가능하고 업로드에는 검증한 사본이 필요하다.

시험은 새 임시 폴더와 가상 자료만 쓰고 종료 시 그 폴더를 정리한다. SIGKILL 시험은 생성한 Linux 자식 프로세스만 대상으로 한다. 제품/실제 사용자 DB/Cloud에는 연결하지 않는다.

[58. 결과/상태/서버 계약](../../docs/v2-design/58-durable-migration-resume-cancel.md) · [56. 로컬 영구 유지 철칙](../../docs/v2-design/56-local-permanence-copy-migration.md)

## 전체 DB18 매핑·서버 RPC

```sh
node --test poc/v2-migration/workspace-map.test.mjs poc/v2-migration/server-rpc.test.mjs
node poc/v2-migration/build-db18-contract.mjs
PYTHONDONTWRITEBYTECODE=1 python3 poc/v2-migration/postgres/run-local.py --evidence-stem migration-map-gateway-postgres
```

계약 생성은 메모리 DB의 스키마만 읽는다. 전체 봉투는 최소문서 SQL 프로필에 전송할 수 없다. RPC는 서버에서 검증한 principal을 요구하며 로그인/JWT 검증을 대신하지 않는다. source/target 해시는 별도이며 journal 연결은 후속이다. [60. 범위·검증·다음 단계](../../docs/v2-design/60-db18-workspace-map-gateway.md)를 따른다.

## DB19 호환성

```sh
node --test poc/v2-migration/db19-compat.test.mjs
```

DB18/19를 실제 스키마로 구분하고 잠금 값을 보존한다. generator 이름은 기존 경로 호환을 위해 유지하지만 DB18·DB19 계약을 함께 만든다. 별도 파일 복원 도구는 합성 표본 왕복 검증만 수행하며 온라인 DB에 본문을 저장하지 않는다. [62문서](../../docs/v2-design/62-db19-copy-contract-compatibility.md)를 따른다.

## 전체 워크스페이스 서버 프로필

```sh
python3 poc/v2-migration/postgres/build-workspace-sql.py
PYTHONDONTWRITEBYTECODE=1 python3 poc/v2-migration/postgres/run-local.py --full-workspace --evidence-stem migration-full-workspace
```

새004는001 뒤에 적용하는 검토용 전진 SQL이며 자동 적용하지 않는다.005는SELECT 검토,006은 전체프로필 미사용일 때만 확장을 되돌린다. 전체프로필 사용 이력이 있으면 rollback을 거절한다. 기본003은 확장006을 먼저 되돌린 뒤 사용한다. 기존 gateway JS의 최소문서 제한은 아직 유지한다. [63. 범위·제한·다음 단계](../../docs/v2-design/63-full-workspace-server-profile.md)를 따른다.

## 전체 프로필 journal 제어 연결

```sh
node --test poc/v2-migration/workspace-session.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 poc/v2-migration/postgres/run-local.py --full-workspace --evidence-stem migration-workspace-session
```

RPC는 allowWorkspaceProfiles:true로 명시적으로 활성화한다. journal version1은 인식/경로/무결성 확인 후2로 올리며 기존 job/asset을 보존한다. source/mapping/target 해시는 별도다. workspace-session은 이미지 없는 공간의 PoC 게시·재조회/취소 제어를 연결하고, 이미지 공간은 실제Storage어댑터 전까지 준비 단계에서 정지한다. [64문서](../../docs/v2-design/64-workspace-gateway-journal-binding.md)를 따른다.

## Storage 이미지 I/O 연결

```sh
node --test poc/v2-migration/workspace-storage.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 poc/v2-migration/postgres/run-local.py --full-workspace --storage-workspace --evidence-stem migration-storage
```

createWorkspaceStorageGateway의 rpc/assetIO를 session에 명시적으로 주입한다. journal version3은 IO intent/terminal 응답/정산의 ID만 저장한다. 불명확한POST는 hash 조회만으로 정산하지 않는다. runner는 외부 Supabase가 아닌 실제 로컬PG/Storage HTTP표본이다. [65문서](../../docs/v2-design/65-workspace-storage-io.md)의 범위/한계/DEV 다음 단계를 따른다.

## DEV 실제 적용 상태(2026-11-10)

001/004는 DEV에 실제 설치·검증됐다. 기존install/C1/C2/KeepAlive 및 이 파일들을 다시 적용하지 않는다. 표본Auth/공간/Blob은 정리됐고 모듈은 유지한다. [66문서](../../docs/v2-design/66-development-migration-live-results.md)와실행증거가 이전 미적용 기록에 우선한다. 제품/native활성화는 아직 아니다.
