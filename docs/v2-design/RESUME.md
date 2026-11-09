# V2 설계·PoC 중단/재개 기록

2026-11-09 UTC · 사용자 요청으로 V2를 여기서 일시 중단하고 main 긴급 UI 패치로 전환한다.

## 보존 위치

- 작업 브랜치: **v2-design**. main에 병합하지 않는다.
- 마지막 기술 검토 커밋: `3f431e1` (이 기록 직전). 이 문서를 포함한 후속 보존 커밋이 재개 출발점이다.
- 설계 목차: [README](README.md), 결정 이력: [04](04-decisions-roadmap.md).
- 최신 상세 결과: [39 SQL 묶음](39-full-bundle-review.md), [40 실행 역할](40-sql-executor-review.md), [41 최종 검토·실제 적용 절차](41-sql-final-review-runbook.md).
- 실제/로컬 증거: `docs/v2-design/evidence/`; 최신 판정 `sql-final-readiness.json`, 검토 `sql-final-technical-review.json`.

## 확정 방향

한국어/영어, 개인 여러 기기 동기화 우선, Windows/macOS 먼저. 로컬 우선 변경분 동기화와 온라인 백업을 구분한다. TLS+서버 저장 암호화로 시작하며 팀·웹·모바일은 후속이다. AWS 직접 운영은 제외하고 초기 **월0원**, 아시아 단일 리전, Supabase Free를 기준으로 한다. Keep Alive는 기본 요구지만 아직 실제 설치하지 않았다.

대상 프로젝트는 `hutqsfftioxtredcjhsy` / 도쿄 `ap-northeast-1`. 사용자가 Free 플랜을 확인했다. 관리 토큰/변수는 환경 설정으로 제공되며 비밀값을 문서/채팅에 넣지 않는다. 재개 시 환경 readiness를 다시 확인한다.

## 완료 범위와 한계

언어 리소스/배포·플랫폼 기능표·인증/동기화/전환/충돌/복구/비용 설계와 독립 PoC를 보존했다. 로컬 SQLite214개, JWT28개, HTTP61개, 영속/복구 통합41개 등은 각 단계 문서의 **서로 다른 범위·실행 시점** 결과다. 합산하여 제품 완성도나 실제 클라우드 검증으로 해석하지 않는다.

최신 SQL은 원자적 install, 권한 확인, 자료 보존 pause/resume, empty-only rollback 묶음이다. 마지막 실행은 SQL87개(기본39+묶음34+역할14), bundle29개·기존 readiness23개 통과. 실제와 같은 BYPASSRLS service_role도 관리 table6개 직접 조회가 거절된다. manifest SHA-256은 `6ace6c937126d792660580a7f253e11db631b8ed56ffe9d9f1e43fdcdfa946ad`다. 재개 시 실제 bytes와 다시 대조한다.

실제 Supabase는 **공식 read-only SQL endpoint의 SELECT와 GET만** 사용했다. Auth6컬럼·역할/권한·RLS·이름 충돌 없음·private schema 미노출 등을 확인했다. 클라우드 DDL/DML, bucket/Auth 사용자/seed 생성, 업무 자료 업로드, gateway 배포, Keep Alive/SMTP 변경, 제품 앱 통합은 하지 않았다. 앱1.23.0/DB18은 이 분기에서 유지했으며 main 긴급 패치는 별도로 진행한다.

## 정확히 남은 조건

`poc/v2-cloud/observations.current.json`의 bundle/rollback/owner 기술 검토는 true다. **실제 설치 승인·쓰기 자격증명 검증은 false**이며 autoApply=false다. 현재 sql-install 판정은 BLOCKED이고 사유는 다음2개다.

- `USAGE_STALE_OR_MISSING`
- `INSUFFICIENT_DATABASE_HEADROOM`

Supabase Usage 화면의 **Database Size 현재 사용량·한도·확인 시각**이 필요하다. 500MB 여부를 사용자에게 요청했지만 답변은 아직 없다. 공식 조직 한도 API는403이었다. 이미 실패한 조회를 반복하거나 토큰 권한을 임의로 확대하지 않는다.

물리 DB 10,917,555 bytes와 파일시스템 여유1,791,406,080 bytes는 무료 Database Size 잔여 한도가 아니다. 임의 차감/추정으로 remainingBytes를 채우지 않는다. Storage/Egress 공식 잔여량과 실제 gateway/private Storage 검증은 후속 cloud-validation 조건이다.

## 재개 순서

1. main 패치를 끝낸 상태/미커밋 파일을 확인한 뒤 v2-design으로 복귀한다. main 패치를 V2에 가져와야 한다면 변경 범위를 검토해서 병합하며, V2 PoC를 main에 통째로 합치지 않는다.
2. 이 문서→41문서→검토/관측 JSON을 읽고 환경 readiness, 대상 ref, Free/월0원 조건을 확인한다. 오래된24시간 관측은 재조회하고 기술 검토 hash와 현재 SQL을 대조한다.
3. 공식 DB Usage 사용량·한도·시각을 확인해 검증 가능한 잔여량을 기록한다. 소스가 바뀌면 해당 검토/시험을 다시 수행한다.
4. DB-only 설치 범위를 사용자와 확정한 뒤 41문서 순서로 실행한다. `bundle/*.sql` 일괄 실행 금지. timeout/응답 유실 시 읽기 조회로 commit 여부부터 확인한다.
5. 설치 후 verify/소유자/ACL을 확인하고 증거를 보존한다. gateway/Storage 성공 flag는 별도 실제 검증 전까지 false 유지한다.
6. 후속 전용 private bucket·가상 사용자/공간·gateway·표본 파일 검증, 메일/Keep Alive, 실제 앱 연결·다국어 이행을 단계별로 진행한다. 각 단계 비용/통신 범위를 다시 확인한다.

이 중단 기록은 V2의 추가 구현/배포를 요청하는 문서가 아니다. 사용자가 재개를 요청할 때 이어서 진행한다.
