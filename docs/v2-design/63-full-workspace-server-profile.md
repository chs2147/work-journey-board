# 63. DB18/19 전체 워크스페이스 서버 저장·검증

2026-11-10 UTC · v2-design · 제품1.24.1/DB19 유지 · 독립 로컬 PostgreSQL PoC

## 이번 완료 범위: 진행 목록 2번

[62문서](62-db19-copy-contract-compatibility.md)의 전체 매핑 봉투를 서버가 직접 검증하고 레코드별로 저장하는 새 전진 SQL `004-workspace.sql`을 구현했다. DB18은 `workspace-db18-map-poc-1`, DB19는 `workspace-db19-map-poc-1`을 사용한다. 최소문서 `migration-document-poc-1`은 그대로 지원한다. 생성기는 두 스키마 계약과 기존001의 제어 코드를 사용하고, 기존001/C1/C2/제품 DB migration은 수정하지 않는다.

## 검증과 저장 경계

서버는 전체 루트/정책·버전별 계약 지문,26테이블의 열/자료형/기본 키 해시·중복·외래 키·행 수·제외 사유를 확인한다. DB19 삭제 잠금0/1, 노트 문서/표/번호/글자색·이미지 소유권, 보드 객체·관계·Live Widget·자료 카드, 가져오기 취소 이력과 지식 자료 locator를 확인한다. 기기 UI/백업/AI 설정, 로컬 폴더 target, 가져오기 전체 경로, 인라인 이미지 본문은 거절한다. JSON 문자열 안에 이스케이프된 이미지 본문도 디코드하여 검사한다. 사용자 본문에 쓴 일반 경로 텍스트는 자동 삭제하지 않는다.

새 `workspace_header`는 records/assets를 뺀 헤더, `workspace_record`는 테이블명·논리 키·JSON 값을 저장한다. 이미지 본문은 어느 쪽에도 넣지 않는다. 이미지 파일 정보는 기존 이관 asset inventory를 공유한다. 새2테이블도 RLS를 켜고 anon/authenticated/service_role의 직접 조회·쓰기를 차단한다. private helper 실행도 차단하며 기존 server-only RPC를 확장한다.

새 `workspace` 액션은 소유 계정/기기/세션과 manifest 해시를 확인한 뒤 저장된 레코드로 봉투를 재구성해 반환한다. staging/connected 상태만 허용한다. 게시 시에도 재구성한 전체 봉투의 서버 해시를 다시 대조한다. 헤더가 없어 NULL 해시가 되더라도 거절한다. 원본 사본 해시와 이 서버 해시는 별개다.

## 기존 안전장치 유지

이미지 파일이 ready인 것만으로 게시하지 않는다. 최신 readback attestation·I/O 정산·lease 종료·publication ticket/fence를 요구하며, 취소와 게시의 원자적 경계는001을 재사용한다. 이미 connected인 공간을 취소해 삭제하지 않는다. 취소된 전체 공간은 조회 API에서 숨기지만 서버 메타데이터를 임의 삭제하지 않는다.

`005-workspace-verify.sql`은 읽기 검토용이다. `006-workspace-rollback-empty.sql`은 전체 프로필 작업 이력이 하나라도 있으면 실패하며 데이터 삭제/CASCADE를 하지 않는다. 전체 프로필이 미사용이면 기존 최소문서 job을 보존하면서 확장만 되돌릴 수 있다. 기본003 rollback은 확장006을 먼저 되돌린 뒤 모든 이관 job이 없을 때만 사용한다.

## 검증과 증거

합성 DB18·DB19는 각각26테이블 모두에 행을 넣는다. 저장·재조회 후 전체 봉투가 일치하며, 삭제 잠금·노트 이미지/썸네일 참조·표·Live Widget·Universe·가져오기 복원 이력과 제외 사유가 보존된다. 잘못된 키/참조/열/형식/행 수/설정/이미지와 초과 크기는 원자적으로 거절한다. metadata 변경·헤더 유실·계정 접근·RLS·취소·rollback·최소문서 회귀도 검증한다.

**최종 PostgreSQL77개(기존40개+전체프로필37개)와 JavaScript145개, 총222개 통과.** [PG 실행 로그](evidence/full-workspace-server-postgres.txt) · [JS 실행 로그](evidence/full-workspace-server-js.txt). 실행 수와 최종 해시는 [PostgreSQL 증거](evidence/migration-full-workspace-pass.json) 및 [통합 집계](evidence/full-workspace-server-regression.json)를 따른다. 실제 PostgreSQL의 함수·권한·락과 가상 Auth/attestation을 사용한 로컬 시험이다. 실제 Supabase/Auth/Storage에 자료를 올리거나 이번 SQL을 적용하지 않았다. 기존39/40개 증거는 당시 기록으로 보존한다.

## 남은 제한과 다음 단계

이 단계는 서버 저장/검증이며 제품의 온라인 이관 완료가 아니다. 기존 JS gateway 어댑터는 최소문서만 허용하므로 아직 이 전체 프로필을 전송하지 못한다. 다음 **3번은 전체 프로필을 gateway/journal과 연결하고 source/target 해시를 별도로 영속 바인딩하는 작업**이다. 이후 실제 Storage readback/삭제 부재 확인과 DEV 적용 검토로 이어간다.

JSON 요청1MiB·레코드2,048개·이미지8개·파일당64KiB는 현재 PoC 제한이다. 초과하면 실패하며 데이터를 생략하거나 원본 이미지를 재압축하지 않는다. 제품용 용량·분할 전송 정책은 별도로 확장해야 한다. receipt는 계속 `poc-verified`이며 제품 실행 가드의 verified 조건을 만족하지 않는다. 로컬 모델 영구 유지·원본 무변경·새 사본 이관 철칙은 [56문서](56-local-permanence-copy-migration.md)를 따른다.
