# V2 설계·PoC 중단/재개 기록

2026-11-09 UTC · V2 설계/PoC 중단 지점을 보존한 뒤 복귀했다. 사용자 요청으로 main 1.23.1 패치(`d11a0ca`)를 v2-design에 병합했다.

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

## 최신 설치 준비 상태

사용자가 Usage 사용량을 **0.026GB**로 제공했다(2026-11-09 UTC, 정확한 기록 시각은 관측 JSON 참조). 기존 사용자 Free 확인과 공식 공개 Free 기본 한도500MB를 적용하면 사용 약26MB/추정 잔여474MB다. 이 값은 표시값에서 계산한 추정치이며 계정별 한도를 API로 독립 확인한 결과가 아니다. 출처·단위·공개 한도 근거는 `observations.current.json`의 databaseUsageEvidence에 보존한다. 기존 물리 DB/파일시스템 여유로 계산한 값이 아니다.

sql-install 준비 판정은 이 기준에서 **REVIEW_READY / autoApply=false**로 갱신했다. bundle/rollback/owner 기술 검토는 완료이며 실제 설치 승인·쓰기 자격증명 검증은 아직 false다. 기존 BLOCKED 증거는 당시 결과로 유지한다. Storage/Egress 잔여량과 실제 gateway/private Storage 검증은 후속 cloud-validation 조건으로 남아 있다.

다음은 **검토된 DB-only 묶음의 실제 설치 범위를 확정한 뒤 적용**하는 단계다. schema2개/table6개/함수7개(공개RPC4개+private3개)가 대상이다. 버킷/계정/파일/메일/Keep Alive/gateway 배포는 포함하지 않는다. 설치 직전 대상/충돌/역할/세션 설정과 한도 변경 여부를 다시 확인한다.

## 재개 순서

1. **완료:** main 1.23.1 업무 메모보드 바로가기 패치(`d11a0ca`)를 v2-design에 충돌 없이 병합했다. 앱 기준은1.23.1/DB18이다. V2 설계/PoC를 main에 병합하지 않았고 클라우드 적용도 수행하지 않았다. 다음 재개는2번부터 진행한다.
2. 이 문서→41문서→검토/관측 JSON을 읽고 환경 readiness, 대상 ref, Free/월0원 조건을 확인한다. 오래된24시간 관측은 재조회하고 기술 검토 hash와 현재 SQL을 대조한다.
3. **진행:** 사용자 Usage 0.026GB와 공개 Free500MB 기준을 출처와 함께 기록했다. 실제 적용 직전 한도/플랜 변경 여부와 관측 신선도를 재확인한다. 소스가 바뀌면 해당 검토/시험을 다시 수행한다.
4. DB-only 설치 범위를 사용자와 확정한 뒤 41문서 순서로 실행한다. `bundle/*.sql` 일괄 실행 금지. timeout/응답 유실 시 읽기 조회로 commit 여부부터 확인한다.
5. 설치 후 verify/소유자/ACL을 확인하고 증거를 보존한다. gateway/Storage 성공 flag는 별도 실제 검증 전까지 false 유지한다.
6. 후속 전용 private bucket·가상 사용자/공간·gateway·표본 파일 검증, 메일/Keep Alive, 실제 앱 연결·다국어 이행을 단계별로 진행한다. 각 단계 비용/통신 범위를 다시 확인한다.

이 중단 기록은 V2의 추가 구현/배포를 요청하는 문서가 아니다. 사용자가 재개를 요청할 때 이어서 진행한다.
