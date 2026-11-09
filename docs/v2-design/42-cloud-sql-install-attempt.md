# 42. 승인된 클라우드 SQL 설치 시도·읽기 전용 연결 차단

2026-11-09 UTC · v2-design · 앱1.23.1 / DB18 유지

## 실제 결과

사용자가 schema2개·table6개·function7개의 DB-only 설치를 승인했다. 검토된 install.sql을 공식 Management API에 **한 번** 보냈지만 HTTP400 / SQLSTATE25006으로 거절됐다.

> cannot execute CREATE SCHEMA in a read-only transaction

후속 공식 read-only verify 결과는 **schema0/table0/function0/public RPC0**이었다. 첫 CREATE SCHEMA 단계에서 실패했고 새 객체는 생성되지 않았다. 자료 삭제·rollback 실행·DDL 재시도는 하지 않았다. 실제 설치 상태는 **NOT_INSTALLED**다.

## 적용 직전 점검

[사전 점검](evidence/cloud-sql-preinstall.json)에서 고정 ref hutqsfftioxtredcjhsy / 도쿄 / ACTIVE_HEALTHY, Auth6컬럼 타입, 세션0/0/false, private schema 미노출, 신규 schema/RPC 충돌 없음·전용 bucket 없음이 일치했다. [후보 소유자 조회](evidence/cloud-sql-owner-inspection.json)와 [기술 평가](evidence/cloud-sql-owner-review.json)도 통과했다.

실제 설치 bytes는 기존 manifest `6ace6c937126d792660580a7f253e11db631b8ed56ffe9d9f1e43fdcdfa946ad`와 install SHA-256 `9a77e28de82583cee850afa5015ddd0007ff515c57a77b63f2ae5e7227a97e4a`에 고정했다. 사용자가 알려준 Usage0.026GB와 공개 Free500MB 기본 한도에 따른 추정 잔여474MB 전제를 유지했다. 이는 계정별 한도 독립 검증을 뜻하지 않는다.

## 실패 원인에서 확인한 사실

[실행 진단](evidence/cloud-sql-write-diagnostic.json)은 /database/query에 `read_only:false`를 명시하되 SELECT만 보낸 결과다.

| 항목 | 실제 결과 |
|---|---|
| execution_role | supabase_read_only_user |
| transaction_read_only | on |
| default_transaction_read_only | on |
| pg_is_in_recovery | false |

**현재 API 연결은 쓰기 요청 옵션에도 읽기 전용으로 실행된다.** 기존 postgres 역할의 권한 조회는 이 API가 실제로 그 역할로 실행한다는 증거가 아니었다. PAT scope·조직 역할·제공자/연동 설정 중 어느 항목이 원인인지는 현재 증거로 단정하지 않는다. 유료 전환이 필요한 문제로 판단하지 않는다.

SET ROLE·read-write transaction 강제 전환 등으로 제한을 우회하거나 권한/설정을 자동 확대하지 않았다. 현재 연결에서 DDL을 반복하지 않는다. 실제 SQL 설치 승인은 이미 받았으므로 같은 범위의 작업에 사용자 재승인을 요구하지 않는다.

## 증거와 준비 검사

- [설치 요청 기록](evidence/cloud-sql-install-attempt.json): 사용자 승인 범위·요청1회·정확한 hash·HTTP400·오류·UTC 시각.
- [설치 후 실제 verify](evidence/cloud-sql-install-verification.json): 생성 객체0개. 기대 설치값과 다르다는 표시는 설치 실패 결과이며 부분 설치의 증거가 아니다.
- [현재 준비 판정](evidence/cloud-sql-readiness-after-attempt.json): BLOCKED / SQL_EXECUTOR_READ_ONLY / autoApply=false.

기존 REVIEW_READY는 쓰기 실행을 실제 시험하기 전의 기술 검토 결과로 보존한다. 알려진 쓰기 불가 상태가 관측되면 설치 준비를 차단하도록 offline preflight를 보완했다. 신규 회귀 포함 bundle30개·기존 preflight23개를 검증했고 생성된 SQL bytes는 바뀌지 않았다. Auth 사용자/버킷/파일/gateway/SMTP/Keep Alive 생성·변경은 하지 않았다.

## 재개 방법

현재 연결이 SQL 쓰기를 수행할 수 있도록 Supabase 토큰/연동 설정을 확인하거나, 소유자가 [프로젝트 SQL Editor](https://supabase.com/dashboard/project/hutqsfftioxtredcjhsy/sql/new)에서 [검토된 install.sql](../../poc/v2-cloud/bundle/install.sql) **하나만** 실행하는 방법이 있다. 키/비밀번호는 채팅이나 Git에 넣지 않고 환경 비밀 설정으로만 제공한다. 쓰기 연결의 구체적인 권한 이름을 확인하지 않은 채 전체 관리자 권한을 요청하지 않는다.

연결이 변경되거나 수동 실행 결과가 전달되면, 먼저 읽기 전용 verify/충돌 점검으로 현재 상태를 확인한다. 이미 설치됐다면 재설치하지 않고 ACL/소유자 검증을 완료한다. 여전히 모두 없고 쓰기 실행 조건이 확인됐다면 동일 승인 범위로 재시도할 수 있다. 응답 유실/부분 상태에서는 자동 DROP/재실행하지 않는다.

이 작업은 실제 Supabase 설치 시도에 관한 기록이며 제품 코드/main/버전/설치판/환경 게시 변경은 없다.
