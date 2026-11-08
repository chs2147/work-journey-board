# 22. V2 논리 DB·권한·동기화 API 계약 초안

2026-11-08 (KST) · Supabase 작업 기준 · 실행 가능한 migration/서버 코드를 생성하지 않았다.

## 22.1 전제

개인 계정의 공간별 원본/기기 사본을 관리하며 PostgreSQL은 서버 수락 상태, SQLite는 해당 기기의 편집·미전송 상태를 갖는다. 양쪽을 같은 파일/스키마로 만들지 않는다. 현재 V1 DB18·마이그레이션은 수정하지 않는다.

아래 본문 검증은 서버가 내용을 처리할 수 있는 암호화 A를 **설계 가정**으로 한다. E2EE를 선택하면 payload·검색·서버 검증·복구 키 계약을 다시 설계해야 한다. 암호화 선택은 아직 확정되지 않았다.

## 22.2 논리 테이블과 범위

| 묶음 | 핵심 필드/제약 | V1 연결 |
|---|---|---|
| product_account | 내부 accountId, auth subject 고유 매핑, 상태 | 새 계정 경계. 이메일을 PK로 쓰지 않음 |
| device_session | accountId, 검증된 auth session, deviceId, revokedAt | 기기 설치 ID만으로 접근 허용 금지 |
| workspace/membership | cloudWorkspaceId, owner, generation, membership | 로컬 폴더/이름과 별개. 초기 owner만 허용 |
| task/period/tag | 공간+안정된 ID·관계·revision/tombstone | category/period/tag·관계 테이블 |
| entry/recurrence | 공간+ID, 부모/업무·날짜·정렬·발생 키·revision | entry_item/recurrence. 부모/자식·중복 발생 검증 |
| weekly_document/summary | 공간+주차 복합키, formatVersion/revision, JSON | week_note/weekly_summary. week_id 단독 전역키 금지 |
| task_note/task_board | 공간+ID, category, formatVersion/revision, JSON | cabi_note/cabi_board. 업무당 보드1개 제약 유지 |
| relation/card/resource | 공간+ID·종류별 참조·revision | Universe/지식 카드/Cabinet. 로컬 폴더의 파일은 자동 업로드하지 않음 |
| document_entry_link | 공간+문서/객체+업무항목 참조 | note_entry_link/cabi_entry_link. 본문과 함께 정합성 검증 |
| blob_metadata | 공간·object key/hash/bytes/mime·상태·보존 참조 | note_asset/cabi_asset 원본. 대형 base64를 문서에 중복 저장하지 않음 |
| applied_operation/change_log | 공간/generation·deviceSession·opId, revision/seq, 결과 | 서버 중복 방지·cursor 수신. domain revision과 별개 |
| snapshot/conflict | 공간/generation·manifest·포맷/버전·보존 상태 | 복원/충돌 사본·자산 참조. Auth secret 제외 |

실제 DDL·index·FK/JSON 검증 함수는 도메인별로 구체화한다. 모든 내용을 검증 없는 범용 JSON 한 테이블에 넣는 것으로 권한/정합성을 해결했다고 보지 않는다. 공간 간 FK/참조는 허용하지 않고 서버가 workspace scope를 검사한다.

기존의 로컬 revision, 서버의 revision, change cursor, generation, 문서 formatVersion, DB schemaVersion은 다른 값이다. API에서 bigint를 쓸 경우 JSON/TypeScript의 안전 정수 범위와 직렬화 계약을 고정한다.

## 22.3 접근 권한과 서버 경계

- Auth가 유효한지 확인한 다음 계정/기기 회수 상태, workspace membership, operation 권한을 매 요청마다 검증한다.
- 업무 쓰기는 제품의 명령 API를 통과한다. 일반 authenticated 역할의 무제한 직접 CRUD를 기본으로 열지 않는다. SELECT도 해당 공간만 보이도록 RLS와 API 조건을 맞춘다.
- server-role이 RLS를 우회할 수 있으면 API 권한 검사와 DB 함수 내부 명령 scope 검사를 생략하지 않는다. JWT payload의 임의 accountId/workspaceId를 신뢰하지 않는다.
- DB 함수의 실행 권한·search_path·입력 타입·부모/참조·expected revision을 제한한다. 함수가 보안 경계를 넓히는 경우 별도 검토한다.
- private Storage 정책은 공간 권한과 확정된 자산 상태를 함께 확인한다. 공개 URL에 UUID를 붙이는 방식으로 비공개 자료를 보호하지 않는다.

## 22.4 push 명령 처리

요청 envelope: protocolVersion, workspaceId, generation, deviceId, opId, batchId, entityType/id, baseRevision, action, formatVersion, payload. 실제 요청 세션은 인증 증명에서 검증하고 deviceId와의 binding을 대조한다.

한 트랜잭션의 순서:

1. workspace/generation·기기 권한을 확인하고 같은 opId의 기존 결과를 찾는다.
2. 기존 op가 있으면 정규화한 요청 hash가 같은지 확인한다. 같으면 같은 결과 반환, 다르면 `IDEMPOTENCY_KEY_REUSED` 거절.
3. 기대 revision·문서 포맷·업무/부모·참조·확정된 blob·공간 한도를 검증한다. 병렬 요청의 CAS/고유 제약으로 경쟁을 처리한다.
4. 도메인 상태·관계 변경·revision/tombstone·change log·멱등 결과를 원자적으로 기록한다.
5. 커밋 후 ack를 반환하고 알림은 보조 신호로 발행한다. 응답 유실 시 같은 opId로 결과를 재조회한다.

batch는 하나의 업무 명령의 정합성 단위다. 보드 JSON/연결 테이블·항목 삭제/참조 정리 같은 변경이 반쯤 커밋되지 않게 한다. batch 내 한 항목만 실패했을 때의 부분 성공을 기본으로 하지 않는다. 요청 크기/명령 수 한도는 fixture/플랜 측정 후 고정한다.

## 22.5 pull과 순서 경계

응답: generation, fromCursor, nextCursor, changes, hasMore, checkpoint. 클라이언트는 데이터 적용+cursor 갱신을 한 로컬 batch로 처리한다.

공간별 commit 순서를 나타내는 cursor가 필요하다. 단순 전역 sequence 할당 순서와 실제 커밋 순서가 다를 수 있으므로, 공간별 counter/직렬화 등 검증된 방식으로 누락 없는 순서를 만든다. 진행 중 미커밋 seq를 지나치고 영구 누락하는 설계를 허용하지 않는다.

동기화 수신 결과를 outbox에 다시 넣지 않는다. cursor 하한 만료·다른 generation·unknown format은 별도 오류다. 전체 재다운로드 전 pending 변경·충돌 사본을 보존하고 새 snapshot과 재조정한다.

[24문서](24-local-poc-review-package.md)에 서버 기준 사본/로컬 편집/편집 기준/불변 전송 명령의 분리와 ack 대기 중 추가 편집 처리를 구체화했다. 수신 적용은 pending을 덮어쓰지 않으며, ack는 해당 op만 완료한다. 셀 전체 저장을 서버의 무조건 교체로 변환하지 않고 항목 수정과 membership/order 변경의 동시성 단위를 나눈다.

## 22.6 이미지와 복원본

업로드 예약→제한된 URL/토큰→실제 bytes 검증→자산 확정→문서 참조 수락 순서다. 예약만 성공한 자산을 다른 기기에 정상 이미지로 공개하지 않는다.

다운로드는 현재 접근 권한을 검사한다. 서명 URL의 잔여 TTL과 세션 회수 효력을 구분한다. GC는 현재 문서뿐 아니라 보존본·tombstone·진행 중 복원/전환의 참조를 포함해 판단한다.

snapshot manifest에는 앱/DB/protocol/문서/백업 포맷 버전, generation/checkpoint, entity hash와 blob hash·크기를 담는다. DB만 되돌리고 파일이 없는 복원을 완료 처리하지 않는다. 전체 복원은 보존본 생성과 새 generation 공개의 별도 명령이며 기존 op를 새 generation에 재적용하지 않는다.

[23문서](23-supabase-free-tier-readiness.md)의 Free 단일 파일50MB 공개 기준을 반영해 큰 백업은 chunk/manifest로 저장한다(10MiB chunk 추천·실제 설정 검증 전). 제한된 직접 Storage 전송·업로드 bytes 예약·불완전본 비공개·모든 chunk/전체 hash 검증이 필요하다. 정상 자동본과 신규 후보본이 교체 중 공존하는 공간까지 확보하며, 부족하면 이전 정상본을 유지한다.

## 22.7 오류·호환성

`AUTH_REQUIRED`, `ACCESS_REVOKED`, `CONFLICT`, `QUOTA_EXCEEDED`, `CURSOR_EXPIRED`, `GENERATION_CHANGED`, `FORMAT_UNSUPPORTED`, `UPGRADE_REQUIRED`, `IDEMPOTENCY_KEY_REUSED` 등 code/args를 사용한다. 앱에서 ko/en으로 표시하고 서버 원문/SQL 상세·비밀값을 그대로 고객에게 내보내지 않는다.

구 클라이언트가 새 문서 필드를 모른 채 저장해 지우는 것을 막아야 한다. minSupportedProtocol·format capabilities를 handshake에서 확인하고, 지원하지 않는 쓰기는 거절하되 로컬 내용의 읽기/내보내기·미전송 사본을 보존한다.

## 22.8 구현 전 남은 검증

도메인별 aggregate/FK·정렬·문서/링크 계약, 동시 op/cursor 커밋 순서, JSON 포맷 정규화, 세션 회수·RPC/RLS·Storage 직접 접근, fixture count/hash·복원, 무료 플랜의 함수/트랜잭션/메일 한도를 확인한다.

현재는 논리 구조와 처리 계약이다. 실제 migration·RLS policy·함수·서버 endpoint·앱 저장소를 생성하거나 시험하지 않았다.
