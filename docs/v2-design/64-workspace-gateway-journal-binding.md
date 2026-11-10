# 64. 전체 프로필 gateway·journal 연결과 해시 영속 바인딩

2026-11-10 UTC · v2-design · 제품1.24.1/DB19 유지 · 독립 PoC

## 보존과 이번 단계

DB19 호환성/전체 서버 프로필은 f1477af로 커밋·푸시했다. 이번에는 진행 목록3번의 **서버 제어 RPC와 영속 journal 연결**을 구현했다. 실제 Storage 파일 I/O 어댑터는 다음4번이며, 이미지가 있는 공간을 연결 완료로 판정하지 않는다.

## 구분해서 저장하는 해시

기존 journal의 `job.source_hash`는 원본 SQLite 파일 hash, `job.manifest_hash`는 분리 사본 manifest의 hash로 유지한다. 새 `workspace_binding`에는 source_manifest_hash(사본 manifest), mapping_hash(전체 봉투의 Node canonical hash), target_manifest_hash(PostgreSQL 재구성 JSONB hash), target_profile을 별도로 기록한다. 어느 값을 다른 해시로 덮어쓰거나 동일하다고 간주하지 않는다.

원본/새 공간ID·계정·기기·job을 검증한 후 매핑 intent를 네트워크 요청 **전에** 기록한다. 서버 start 응답에서 공간/source/profile을 대조해 target hash를 한 번 바인딩하며, 이후 변경은 거절한다. 전체 metadata를 다시 받아 mapping hash와 일치해야 metadata_verified를 기록한다. journal에는 업무 본문·이미지·인증 키·파일 경로를 저장하지 않는다.

journal user_version은2다. 기존 application_id/버전1과 보호 경로·alias·무결성을 먼저 확인한 뒤 트랜잭션으로 새 테이블만 추가한다. 기존 job/asset·작업ID는 유지한다. 레거시 사용자 DB나 인식되지 않는 파일을 journal로 열지 않는다.

## RPC 연결과 복구

`createMigrationRPC`는 `allowWorkspaceProfiles: true`일 때만 전체 DB18/19 프로필과 workspace 조회를 허용한다. 기본값의 최소문서 제한은 유지한다. DEV 목적지·인증된 principal·server key·크기·오류 allowlist·응답 형식 검증을 유지한다. 전체 start는1MiB, workspace 응답은1MiB+8KiB로 제한한다. JWT 검증 자체를 대체하지 않는다.

`advanceWorkspaceSession`은 실제 start/status/workspace/publication/prepare_publish/publish/cancel/finish_cancel을 호출한다. journal lease/fence/epoch와 고정 job/operation을 사용한다. 시작 응답 유실은 같은 사본으로 같은 job을 replay한다. 게시 응답 유실은 서버의 authoritative publication 결과로 재조회하며 이미 끝난 게시를 반복하지 않는다. 취소 응답 유실도 같은 취소 operation과 서버 epoch로 이어간다.

게시/취소 복구는 target binding이 있으면 사본 파일 없이 가능하다. **start 응답을 잃고 target hash도 없는 상태에서 사본까지 없어지면** 안전한 재연결 근거가 없으므로 중단한다. timeout만으로 서버 부재나 취소 완료를 추정하지 않는다. 새로운 원본 편집은 기존 사본으로 수집하지 않는다.

취소 중 늦게 도착한 start 콜백은 lease가 바뀌어 로컬 바인딩을 쓰지 못한다. 이후 같은 start를 replay해 서버 상태를 확인하고 취소 fence를 적용한다. pending publication은 두 번째 ticket을 생성하지 않는다.

## 완료 판정과 이미지 경계

현재 receipt는 계속 `poc-verified`다. 성공 시 binding.phase만 poc_verified로 기록하며 제품 job을 connected로 바꾸지 않는다. 원본/target/profile/publication ID/generation이 맞지 않거나 verified로 승격한 receipt는 거절한다. 레거시 coordinator도 전체 binding을 발견하면 거절하므로 증표를 우회 적용하지 못한다.

이미지가 있는 공간은 전체 metadata 저장·재조회까지 진행하고 **ASSET_GATEWAY_NOT_CONNECTED**로 정지한다. 업로드/attest를 허위 수행하지 않는다. 취소는 서버 fence를 먼저 적용하지만 실제 Blob 부재 증명이 없으면 **STORAGE_ABSENCE_VERIFICATION_REQUIRED**로 유지한다. 이번 단계는 이미지 업로드/삭제까지 포함한 전체 이관 완료 시험이 아니다.

## 검증과 다음 단계

**신규 세션26개+기존145개 JavaScript171개와 PostgreSQL80개, 총251개 통과.** 별도 HTTP→실제 로컬PG→RPC→SQLite journal 통합은64KiB를 넘는 가상 metadata로 시작·게시·취소 응답 유실/재열기를 확인한다. 이 통합의 공간은 명시적으로 이미지 없는 합성 표본이며 실제 Blob은 사용하지 않는다. 기존 전체 서버 시험은 이미지 inventory/attestation을 가상 proof로 검증한다.

최종 실행 수·소스 해시·컨테이너 정리는 [통합 집계](evidence/workspace-session-regression.json)와 [PG 증거](evidence/migration-workspace-session-pass.json)를 따른다. [JS 로그](evidence/workspace-session-js.txt) · [PG 로그](evidence/workspace-session-pg.txt). 이전63문서의77개 결과는 당시 증거로 유지한다. 제품 코드/로컬 원본/실제 Supabase/KeepAlive/환경/과금/배포는 변경하지 않았다.

다음은 **4번 실제 Supabase Storage I/O 어댑터 연결**이다. 이미지 전송/재조회 hash·크기 검증, C2의 예약/lease/IO정산과 job operation 연결, 취소 fence 이후 삭제·부재 확인을 연결한다. 그 뒤 DEV 전진 SQL 적용 검토 및 전체 이관 검증으로 이어간다. 로컬 모델 영구 유지·새 사본 이관·온라인 DB/Blob 본문 분리 철칙은 [56문서](56-local-permanence-copy-migration.md)를 따른다.
