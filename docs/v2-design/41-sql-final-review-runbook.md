# 41. SQL 최종 기술 검토·적용 절차

`v2-design` · 2026-11-09 UTC · 앱1.23.0 / DB18 유지

## 이번 단계 결과

`8621d06`의 원격 반영을 확인하고 [39문서의 설치 묶음](39-full-bundle-review.md), [40문서의 실행 역할](40-sql-executor-review.md), 실제 SQL·생성 해시·시험 증거를 교차 검토했다. **설치 묶음과 되돌리기 절차의 기술 검토를 완료했다.** 실제 설치 승인/실행이나 운영 서비스 준비 완료를 의미하지 않는다.

추가로 로컬 `service_role`을 실제 Supabase와 같은 BYPASSRLS=true로 맞췄다. 이 역할로 관리 테이블6개를 각각 직접 SELECT하면 모두 권한 거절되는 시험을 추가했다. RLS 우회가 가능한 서버 역할에도 SQL ACL이 적용되는지 확인한다. 변경은 로컬 fixture에만 있으며 설치 artifact는 바뀌지 않았다.

검토 대상의 정확한 manifest/source/artifact 해시와 판정은 [최종 기술 검토 기록](evidence/sql-final-technical-review.json)에 보존한다. 이 파일과 관측 JSON은 검토자의 기록이며 전자 서명이나 외부 승인 증명은 아니다.

## 검토표

| 항목 | 판정과 근거 |
|---|---|
| 범위/대상 | ref hutqsfftioxtredcjhsy, 도쿄, 월0원, DB-only, autoApply=false |
| 생성 일치 | bundle check 통과. 입력3개·템플릿5개·출력6개와 manifest 일치 |
| 원자적 설치 | 단일 BEGIN/COMMIT, 기존 schema/RPC 충돌 시 전체 rollback. 기존 객체 대체 없음 |
| 접근 권한 | RLS table6개·함수7개, client/PUBLIC 실행0·service public RPC4·직접 table CRUD0 |
| 실행 소유자 | 실제 postgres는 비 superuser/BYPASSRLS. 필요한 Auth6컬럼 SELECT와 생성 권한 조회 완료 |
| 자격 증명 경계 | read-only 관리 API만 사용. 실제 쓰기 자격증명 검증/권한 확대 없음 |
| 자료 보존 중단 | ingress 중단 후 pause. RPC 권한 회수, 사용자 자료 삭제 없음. 이미 진행 중인 요청은 별도 확인 |
| 재개 | 동일 검토 artifact·명시적 marker 후 기존 server-only 권한 복구 |
| 빈 설치 제거 | 관리 table6개 잠금, 한 행이라도 있으면 거절, CASCADE 없음, 예상 밖 의존성도 전체 취소 |
| 자료 존재 시 복구 | 제거하지 않고 pause/보존 후 이관·복구 계획 수립. 강제 삭제 우회 없음 |
| 제품 영향 | 앱/DB18/main/설치판·사이트·환경 게시 변경 없음 |

## DB 용량 조회 결과

공식 관리 API의 `GET /v1/projects/{ref}/config/disk/util`은 HTTP200을 반환했다([조회 기록](evidence/sql-final-disk-check.json)). 파일시스템 총2,077,073,408 bytes, 사용285,667,328 bytes, 여유1,791,406,080 bytes였다. 이는 프로젝트의 물리 볼륨 지표이며 **무료 Database Size 허용량이나 과금 잔여량이 아니다.** 앞서 조회한 pg_database_size 역시 다른 지표다. 두 값을 500MB 한도에서 임의 차감해 공식 잔여량으로 기록하지 않는다.

조직 플랜은 사용자 Free 확인을 유지하고, 이미403인 조직 한도 API의 재호출/토큰 권한 확대는 하지 않았다. Usage 화면의 Database Size **현재 사용량·한도·확인 시각**이 아직 필요하다. 현재 SQL 설치 준비 검사에 남은 차단 사유는 `USAGE_STALE_OR_MISSING`, `INSUFFICIENT_DATABASE_HEADROOM`이다. Storage/Egress는 후속 실제 파일 전송 검증 때 별도로 확인한다.

## 실제 적용 시 수행 순서

아래는 **미실행 절차**다. 일괄 실행 스크립트를 추가하지 않았다. 표의 확인을 완료하고 실제 DB-only 적용 범위가 확정되기 전에는 install을 실행하지 않는다.

1. 고정 project ref/Free/공식 DB 잔여량을 재확인하고 현재 SQL 묶음과 검토 해시가 같은지 `bundle.mjs check`로 확인한다. 기존 관측이24시간을 넘거나 설정/SQL이 달라졌다면 해당 항목을 다시 검토한다.
2. `preinstall.sql`, `inspect-owner.sql`을 읽기 전용 endpoint로 다시 조회한다. schema2개·동명 public RPC가 없고 Auth6컬럼/역할/세션 정책/Data API 노출이 검토 조건과 같은지 확인한다. 충돌이나 드리프트가 있으면 중단한다.
3. 검토된 실제 설치 연결이 대상 프로젝트와 맞는지 확인한다. 선택한 연결/자격증명과 실행 시각을 비밀값 없이 기록한다. 토큰이 read-only 조회에 성공했다는 사실만으로 쓰기 권한을 추정하지 않는다.
4. **install.sql 하나만** 한 번 실행한다. bundle 폴더의 SQL을 일괄 실행하지 않는다. 에러/timeout/응답 유실이면 즉시 재실행하거나 DROP하지 말고 읽기 전용 verify와 namespace/RPC 상태로 commit 여부부터 판별한다.
5. `verify.sql` 결과를 manifest.expectedVerification의 모든 값과 비교하고 함수 소유자가 postgres/비 superuser/BYPASSRLS인지 확인한다. 실제 결과·HTTP 상태·query hash·시각을 보존한다. 모두 맞아야 DB 설치 단계 완료다.
6. 결과가 다르면 외부 유입을 중단하고 pause로 보존한다. 빈 설치 제거는6개 table이 모두 비어 있고 예상 밖 의존성이 없을 때만 검토된 marker+rollback으로 수행한다. 자료가 있으면 제거하지 않는다. 응답 유실 시에도 자동 정리하지 않는다.
7. 성공하더라도 gateway/private Storage 검증 flag를 올리지 않는다. 버킷·시험 계정·seed·파일 전송·Keep Alive·SMTP·gateway 배포는 별도 후속 범위다.

설치 후 보존할 항목은 대상/ref·manifest SHA-256·실행자 역할·UTC 시각·install 응답 상태·verify 원문과 비교 결과다. 키·비밀번호·Auth 사용자 행·실제 업무 본문은 기록하지 않는다. 설치 완료 기록은 지금 생성하지 않는다.

## 검증과 남은 단계

이번 변경 후 로컬 SQL **87개**가 통과했다(기존 최소39 + 전체 묶음34 + 역할 재현14). 생성/준비 단위 시험29개와 기존 준비 시험23개도 통과했다. [SQL 증거](evidence/sql-final-sql-pass.json)와 [로그](evidence/sql-final-sql-pass.txt)는 실제 실행 파일 해시를 포함한다. 이전86개 결과는 당시 증거로 보존하며 새 수치로 덮어쓰지 않는다.

`bundleReviewed=true`, `rollbackReviewed=true`는 이번 기술 검토 완료를 기록한다. `installationAuthorized=false`, `autoApply=false`는 유지한다. 공식 DB 사용량/한도 확인 후 실제 DB-only 설치 여부를 결정하는 것이 다음 단계다. 현재까지 클라우드 DDL/DML·사용자/버킷 생성·파일 전송·배포는 수행하지 않았다.
