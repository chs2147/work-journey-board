# 59. PostgreSQL 이관 서버 테이블·RPC·연결/취소 원자성

2026-11-10 KST · v2-design · **로컬 PostgreSQL 검증/신규 SQL 검토안. 개발/운영 Supabase 미적용.**

## 구현과 결과

[001-migration.sql](../../poc/v2-migration/postgres/001-migration.sql)에 private schema wjb_migration의 job/asset/document3개 테이블, RLS, private helper5개·server 전용 public RPC1개, 기존 gateway의 새 이관 공간 한정 INSERT gate1개를 구현했다. 공개 함수명은 public.wjb_v2_migration_command(jsonb)이지만 **실행 권한은 service_role만** 가진다. anon/authenticated의 실행과 모든 client/service_role의 직접 테이블 접근을 차단한다.

공식 digest 고정 PostgreSQL17.11 컨테이너에서 **서버 검사39개**가 통과했다. NOSUPERUSER/BYPASSRLS 소유자 wjb_owner를 사용해 실제 개발의 postgres 소유자 권한 클래스와 맞췄다. DB 연결을 나누어 연결 확정/취소를 실제로 경쟁시켰다. Auth users/sessions는 가상 테이블이며 JWT 서명을 검증한 실제 Supabase 환경 시험은 아니다. [증거](evidence/migration-postgres-pass.json)에 서버 버전·이미지 digest·시험·소스 hash·컨테이너 제거 확인을 기록한다.

## 지원 범위와 완료 증표 구분

서버의 현재 프로필은 **migration-document-poc-1**이다. 문단(text)과 이미지 참조(asset UUID/alt), 파일 최대8개·각64KiB, 문서 최대16개·총 JSON64KiB의 검토용 계약이다. 업무/주간/캐비넷/Universe 전체 DB18 매핑·전체 문서 포맷 지원이 아니다. 알 수 없는 블록/키는 생략하지 않고 거절한다.

서버 완료 결과는 status=**poc-verified**/profile=migration-document-poc-1이다. 실제 SQL 결과를57문서의 실행 가드에 넣어 **MIGRATION_NOT_VERIFIED로 거절되는 것**을 시험했다. 최소 프로필의 연결 완료를 제품 워크스페이스 이관 완료로 표시하지 않는다. 제품용 verified 증표는 전체 도메인 매핑/manifest 검증을 구현한 뒤 별도 프로필 계약으로 다룬다.

DB의 문서/manifest에는 일반 텍스트와 참조만 저장한다. 이미지 노드는 UUID/alt만 허용하고 data/src/base64 필드를 받지 않는다. data:image URL과 지원 이미지의 알려진 inline 서명을 거절한다. 임의 텍스트를 모든 가능한 이미지 인코딩으로 분류하는 범용 검사기는 아니며, 제품의 원본 파서/추출기와 서버 typed schema를 함께 연결해야 한다. 실제 이미지 본문/썸네일은 Supabase private Storage에만 둔다. 원본 로컬 DB/모델은 영구 유지한다.

## manifest 바인딩

sourceManifestHash는56문서 추출 사본의 digest로 별도 보존한다. 서버는 UUID/정수·자산/문서 정렬을 정규화한 **target manifest**를 PostgreSQL jsonb::text→UTF-8→SHA256으로 계산한다. JSONB text hash를 Node의 기존 canonical JSON hash와 같은 값이라고 가정하지 않는다.

최종 연결 직전에 서버 테이블에서 target manifest를 재구성해 저장된 digest와 대조한다. 다른 payload의 같은 job ID 재사용·metadata 변조·다른 공간/작업 ID를 거절한다. 후속 클라이언트 mapper/journal은 source digest와 target digest를 각각 바인딩해야 하며 기존 manifest_hash를 조용히 다른 의미로 덮어쓰면 안 된다. 현재58문서 journal과 이 SQL 사이의 실제 어댑터는 아직 없다.

## 실제 서버 안전 경계

- 기존 session guard와 기기/계정/session 바인딩을 매 호출 검증한다. server role이 전달하는 principal은 gateway가 검증한 토큰에서 가져와야 하며 클라이언트 본문의 userId를 신뢰하는 API가 아니다.
- C2와 같은 **device→workspace→job→정렬한 asset** 잠금 순서를 사용한다. 같은 공간의 publish/cancel은 서로의 트랜잭션 완료를 기다리고 한 결과만 확정한다.
- 생성은 새 workspace/job만 허용한다. manifest에 없는 자산의 기존 C2 reserve는 새 trigger로 막는다. 이관에 속하지 않은 기존 gateway 공간은 그대로 동작하는 것을 시험했다.
- 파일이 ready여도 최신 readback attestation과 정확한 io_version, 미종료 I/O0·활성 lease0이 없으면 publish를 거절한다. attestation은60초 freshness를 가지며 그 사이 version이 바뀌면 재검증한다.
- **SQL은 외부 Blob bytes를 직접 읽지 않는다.** attest는 trusted gateway가 실제 private bytes의 hash/크기를 재조회한 후에만 호출한다. confirm_absent도 실제 삭제 후 부재 확인이 선행돼야 한다. untrusted client의 ‘검증 완료’ boolean을 받지 않는다. 이번 SQL 시험의 readback/삭제 증명은 가상 server 역할로 모사했으며 실제 Storage 어댑터 연결은 후속이다.
- 원본 이미지는 추출/업로드 성공 후에도 삭제하지 않는다. source SQLite 파일/backup/migration을 이 SQL이 열거나 수정하지 않는다.

## 응답 유실과 늦은 연결 요청

SQL에 연결 확정 요청 ID·30초 ticket/token·증가하는 publish fence를 영속 저장했다. publication 재조회가 단순히 ‘아직 안 보임’을 종료 증거로 사용하지 않는다.

1. 활성 ticket이 있으면 pending/operationSettled=false다.
2. ticket 만료 또는 아직 실행되지 않은 요청을 재조정할 때 workspace/job 잠금을 잡고 fence를 증가시킨다. 이전 token과 이전 expectedFence의 늦은 prepare 요청을 거절한 뒤 absent/operationSettled=true를 반환한다.
3. 재시도는 반환된 serverFence로 새 ticket을 받고 같은 operation ID/manifest에만 연결한다.
4. 이미 commit됐다면 원래 PoC receipt를 재사용하고 다시 생성/게시하지 않는다.

이 재조회는 **fence를 갱신하는 조정 명령**이며 순수 SELECT가 아니다. 새 서버 어댑터는 publication→prepare_publish→publish/ticket 수명주기를 명시적으로 연결해야 한다. 기존 journal의 로컬 READY/로컬 fence를 서버 ticket 대신 쓰지 않는다.

## 취소와 I/O 정리

cancel은 연결 확정보다 먼저 잠금을 얻은 경우에만 cancel_fenced로 전환하고 publication ticket을 무효화한다. 이관 소유 gateway 자산을 cleanup 상태로 옮겨 늦은 begin_io/mark_ready를 막고 기존 I/O ledger는 남긴다. 이미 발급된 요청이 끝나기 전에는 부재/취소 완료를 확정하지 않는다. 기존 C2 settle_io bookkeeping으로 종료를 기록한 후 다시 검증한다.

이미 connected이면 cancel은 connected receipt를 반환하며 파일을 삭제하지 않는다. confirm_absent는 정확한 IO version/작업 종료 확인 후 canceled/예약량 반환을 한 번만 수행하고 재호출은 멱등 처리한다. finish_cancel은 모든 자산 부재 확인/미종료 I/O0일 때만 완료한다. timeout/lease 만료만으로 미확정 I/O를 없애는 강제 정리는 없다.

서버/gateway가 죽어 I/O 종료를 입증하지 못한 경우에는 보수적으로 남는다. 실제 worker의 영속 요청 장부/종료 증거·복구 절차와 엮어야 하며 관리자가 임의로 settled=true로 바꾸는 정책은 승인하지 않는다.

## 시험 범위

39개에는 클라이언트 접근/직접 DML 차단, 계정/ban/세션 회수, canonical replay, inline/누락/중복/미지원 참조, C2 미등록 자산 차단, readback/version/freshness·미종료 I/O, ticket 만료·늦은 prepare/연결, 취소/예약량 멱등, 두 실제 PG 연결의 publish-first/cancel-first, 기존 비이관 공간 보존, 모듈 재적용/빈 rollback·사용 중 rollback 거절, 실제 receipt의 실행 가드 거절이 포함된다.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 poc/v2-migration/postgres/run-local.py
```

network none/포트 없음/CPU1/메모리512MiB/tmpfs256MiB의 자신의 컨테이너만 만들고 제거했다. 로컬 이미지가 없으면 도구가 실패하며 다른 DB/Cloud로 fallback하지 않는다. PostgreSQL 서버 재시작/전원 장애·실제 Supabase Auth/Storage 성능·native OS 실기를 증명하지 않는다.

## 개발 적용 준비물

| 파일 | 성격 |
|---|---|
|[000-preflight.sql](../../poc/v2-migration/postgres/000-preflight.sql)|기존 C1/C2·새 schema/RPC/trigger 충돌 SELECT |
|[001-migration.sql](../../poc/v2-migration/postgres/001-migration.sql)|한 트랜잭션의 신규 전진 검토 SQL. 재적용은 실패 |
|[002-verify.sql](../../poc/v2-migration/postgres/002-verify.sql)|객체/RLS/search_path/권한/이미지 binary 컬럼 확인 SELECT |
|[003-rollback-empty.sql](../../poc/v2-migration/postgres/003-rollback-empty.sql)|job이 전혀 없는 새 모듈만 제거. CASCADE/데이터 삭제 없음 |
|[review-manifest.json](../../poc/v2-migration/postgres/review-manifest.json)|DEV 목표/소스 hash/범위/미적용/autoApply=false |

새 trigger가 기존 gateway asset INSERT 경로와 만나는 것도 검토 범위다. 기존 설치 bundle/SQL은 변경하지 않았으며 **install.sql 재실행은 금지**한다. 사용 이력이 있으면 빈 rollback 대신 보존형 전진 복구를 설계한다.

## 다음 단계

1. 전체 DB18 업무/문서·논리 자산/Blob 참조를 보존하는 서버 mapper/profile을 설계·구현하고 기기 설정/경로 제외 및 모든 이미지 본문 분리를 검증한다. 현재 최소 프로필을 제품 완료로 승격하지 않는다.
2. source/target manifest 이중 바인딩, journal 버전/서버 ticket, 실제 gateway readback/absence와 새 RPC allowlist 어댑터를 연결해 로컬 PG+HTTP 통합 검증한다.
3. 검토한 신규 SQL/ACL/원본 보존·월0원 조건으로 DEV Supabase 적용/실제 통합을 진행한다. 현재 모듈은 아직 미적용이고 native 앱/실제 제품 이관도 미완료다.

제품 버전/기존 DB18/로컬 기능/설정/환경/운영 DB/과금/사이트/설치판은 변경하지 않았다.

이번 서버39개와 로컬 journal/격리/사본/DB18 회귀103개로 [총142개 검증](evidence/migration-postgres-regression-pass.json)을 기록했다. 서버 텍스트 로그는 실제 결과 JSON에서 생성한 요약이며 원시 stdout으로 표시하지 않는다.
