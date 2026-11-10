# 65. 전체 이관의 Storage 전송·readback·취소 연결

2026-11-10 UTC · v2-design · 제품1.24.1/DB19 유지 · 독립 PoC

## 이번 단계의 구현 범위

[64문서](64-workspace-gateway-journal-binding.md)의 전체 이관 제어에 `createWorkspaceStorageGateway`를 연결했다. 기존 Supabase private Storage REST 어댑터와 C2 asset RPC를 재사용하며 DEV 목적지·server key·이미 검증된 principal을 명시적으로 받는다. 환경변수 읽기/외부 자동 요청/공개 서버 배포는 하지 않는다. JWT 검증 자체를 대체하는 API가 아니며 trusted server 안에서만 사용한다.

업무 데이터/이미지가 있는 새 사본을 대상으로 metadata 저장·원본/target hash 검증 → C2 업로드 예약/lease/IO intent → putIfAbsent → 실제 응답 bytes readback·SHA256/크기 검증 → ready → 최신 readback attestation → 게시로 연결한다. 온라인 DB에는 이미지 본문을 넣지 않고 원본 로컬 DB와 분리 파일은 유지한다. 동일 bytes를 공유하는 논리 이미지 참조는 유지하면서 Blob 전송은 inventory 기준이다. 공개 URL 대신 workspaceUUID/objectUUID 경로를 사용한다.

## 영속 IO 상태와 응답 유실

journal version3은 인식된2번 journal에 `storage_io` 테이블만 트랜잭션으로 추가한다. 원래 job/asset/binding은 그대로 보존한다. 작업ID·원래 세션ID·C2 lease UUID/fence·단계만 기록하고 인증 키/파일 경로/이미지 bytes는 저장하지 않는다. lease UUID는 API 인증 키와 다르다.

단계는 prepared → acquired → begun → dispatching → confirmed → settled다. 파일 전송보다 IO intent를 먼저 등록하고 dispatching을 기록한다. terminal HTTP 응답(정상 또는 이미 존재)이 확인돼야 confirmed를 기록하고 settle_io를 호출한다. 서버 정산 응답 유실은 같은 intent/token/fence로 replay한다. 확정된 전송의 늦은 완료 콜백은 취소가 job lease를 무효화한 뒤에도 **그 IO receipt만** 정산할 수 있으며 job을 성공 상태로 바꾸지 못한다.

서버가 ready로 바뀐 응답을 잃으면 재조회/readback/attest로 복구한다. bytes 전송이 확정·정산됐지만 ready 전환 전 중단된 경우에는 현재 파일의 hash/크기와 모든 IO 정산을 확인한 뒤 C2의 recover_ready audit로 복구한다. 일반 recovery worker의 검토 정책을 우회하는 공개 명령은 추가하지 않으며 이 경로는 명시적 이관 job의 immutable inventory에 한정한다.

**Storage POST 자체의 응답이 불명확하면** 파일이 보이거나 timeout이 지났다는 이유만으로 settled로 바꾸지 않는다. dispatching과 서버의 미정산 intent를 유지하고 게시/삭제를 중단한다. 프로세스 종료로 완료 증거가 사라진 경우도 보수적으로 보류한다. 만료된 lease/확정되지 않은 begin 등 자동 재개가 불가능한 상황은 별도 운영 복구 증명이 필요하며 이 단계에서 임의 해제하지 않는다.

## 취소와 늦은 업로드

서버의 cancel fence를 먼저 적용한다. 모든 기존 IO가 정산되고 lease가 끝난 것을 서버가 확인하기 전에는 파일을 삭제하지 않는다. 취소 중 늦은 업로드는 intent가 미정산이므로 삭제를 차단하고, terminal 응답을 받은 worker가 정산한 뒤 다음 취소 재개가 파일을 제거한다.

DELETE의2xx만으로 용량을 반환하지 않는다. 삭제 후 private GET의 명확한 Object not found를 확인하고, C2 lease를 해제한 뒤 부재를 다시 확인해 io_version에 묶인 confirm_absent를 호출한다. 권한 오류/형식을 알 수 없는 HTTP400/Storage 장애는 부재로 간주하지 않는다. 취소 완료 후 서버 used_bytes가0인지 시험한다. 이미 connected인 공간은 삭제 경로로 들어가지 않는다.

## 검증 범위와 한계

**JavaScript280개(신규 journal/어댑터6개 포함)와 PostgreSQL89개, 총369개 통과.** 기존 이관·gateway·recovery 회귀를 함께 실행했다. 실제 로컬 PostgreSQL과 실제 HTTP 송수신을 사용하는 Storage protocol endpoint에서9개 시나리오를 시험한다: 정상 이미지 이관, ready 응답 유실, 정산 응답 유실, 취소, DELETE 응답 유실, 모호한 부재 응답, 취소 뒤 늦은 POST, POST 자체 응답 유실, readback hash 불일치.

Storage endpoint는 **로컬 표본 서버**다. Supabase의 실제 호스팅 Storage에 이번 이관 자료를 올린 결과가 아니다. private REST endpoint·header·본문/오류 계약은 기존 실제55문서의 어댑터를 그대로 쓰며 이번에는 전체 이관과의 연결·경쟁을 검증한다. PostgreSQL/C1/C2/이관 SQL은 실제 실행하지만 Auth는 가상 fixture다. 기존 제품 앱/원본/실제Cloud/환경/KeepAlive/과금/배포는 변경하지 않았다.

최종 수·소스 hash·정리 결과는 [검증 집계](evidence/workspace-storage-regression.json)와 [PG 증거](evidence/migration-storage-pass.json)를 따른다. [JS 로그](evidence/workspace-storage-js.txt) · [PG 로그](evidence/workspace-storage-pg.txt). 이전 단계 증거는 그대로 보존한다. receipt는 poc-verified이며 제품 활성화는 계속 차단한다.

## 다음 단계

**5번 DEV 전체 이관 통합 검증 준비/실행**이다. DEV 상태를 새로 읽고001/004 새 전진 SQL의 설치 여부·소유자·ACL·hash를 대조한다. 기존 C1/C2 install.sql과 KeepAlive는 재설치하지 않는다. 미적용 새 SQL 검토 후 가상 계정/새 공간/private bucket을 사용한 실제 Supabase/Auth/Storage 이관·취소·정리 검증으로 이어간다. 필요한 실제 적용 범위와 현재 검토본을 정리한 뒤 진행한다. 제품용 파일64KiB/자산8개 제한 확장과 native UI 연결은 별도 후속이다. 원본을 지우지 않는 새 사본 이관·로컬 영구 유지 철칙은 [56문서](56-local-permanence-copy-migration.md)를 따른다.
