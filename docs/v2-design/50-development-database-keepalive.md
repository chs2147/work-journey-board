# 50. 개발 DB 설치·건물수첩 방식 KeepAlive 적용 결과

2026-11-09 KST · v2-design · 개발 vsphftnmfzfoufasjttd / 서울 · 앱1.23.3·로컬 DB18 유지

## 완료 결과

사용자의 다음 단계 및 건물수첩 동일 방식 KeepAlive 적용 요청으로 **개발 DB에만** 모듈 SQL과 KeepAlive를 한 트랜잭션으로 적용했다. 운영 예정 hutqsfftioxtredcjhsy에는 접속/쓰기/cron을 수행하지 않았다. 환경 설정을 재적용하거나 게시하지 않았다.

| 범위 | 검증 결과 |
|---|---|
| 기본 모듈 | schema2 / table6 / function7 / public RPC4, 예상값 일치 |
| 권한 | table6 RLS 활성, client/PUBLIC 함수 실행0, service 직접 table CRUD0, 서버 public RPC4만 허용 |
| 소유자 | postgres / superuser=false / BYPASSRLS=true |
| KeepAlive 추가 | pg_cron1.6.4, public.keepalive_pings 테이블1개·고정1행 |
| 작업 | keepalive_ping / 매일03:00 UTC = **매일12:00 KST** / active=true |
| 실제 cron timezone | GMT. 위 시각 환산과 일치 |
| heartbeat 접근 | RLS 활성, anon/authenticated/service_role 직접 CRUD 차단 |
| 스케줄러 검증 | 같은 command의 임시5초 job 실행 성공·heartbeat 시각 갱신 확인 후 즉시 unschedule |
| 최종 작업 수 | keepalive_ping1개. 임시 probe job 없음 |

테이블 총수는 기본 모듈6개에 heartbeat1개를 더한 것이다. 사용자/기기 seed·Auth 사용자·bucket·이미지 업로드·gateway 배포·본문 동기화·새 blob dedup schema는 이번 범위에 포함하지 않았다.

## 건물수첩과의 대응

[기존 0012_keepalive.sql](https://github.com/chs2147/woori-bldg/blob/a8fdf4733987e77ddce359b4caf4d4642d8ebae5/supabase/migrations/0012_keepalive.sql)의 **DB 내부 pg_cron → 단일 heartbeat 행 UPSERT**를 그대로 채택했다. GitHub Actions·외부 키·주기 HTTP ping 방식이 아니다. 소스 hash·동일점/추가점은 [참고 구현 기록](evidence/development-keepalive-reference.json)에 보존한다.

주기는 기존과 동일하다. 보완점은 API 역할의 명시적 권한 회수, 기존 동명 job/table의 무단 대체 방지, 해당 일일 job 로그만14일 보관하는 DELETE다. 다른 job 로그는 정리하지 않는다. probe 로그는 unschedule 후 소량의 진단 기록으로 남으며 고빈도 job은 남기지 않았다.

이번 검증은 초기 INSERT만 확인한 것이 아니다. cron.job_run_details의 succeeded와 실제 pinged_at 증가를 확인했다. 다만 **정규 일일 job의 첫 정오 실행은 아직 관측하지 않았고**, 동일 명령의 임시 job으로 스케줄러/SQL 실행을 검증했다. 다음 정오 실행 후 정규 job 최근 실행·마지막 시각을 확인한다.

이 방식이 Supabase 휴면 판정에 계속 인정돼 영구적으로 pause를 방지한다는 보장은 아니다. 프로젝트가 pause되면 내부 cron이 스스로 재개할 수 없을 수 있다. 장기 idle 상태/마지막 실행/프로젝트 상태를 분리해 관찰하며 외부 스케줄을 자동 추가하지 않는다. 로컬 원본/오프라인 사용은 서버 상태와 독립적으로 유지한다.

## 개발 전용 SQL 묶음과 재현

[개발 manifest](../../poc/v2-cloud/development/bundle/manifest.json), [설치](../../poc/v2-cloud/development/bundle/install.sql), [모듈 verify](../../poc/v2-cloud/development/bundle/verify.sql), [KeepAlive verify](../../poc/v2-cloud/development/bundle/keepalive-verify.sql)를 보존한다. 기존 운영 예정 bundle/source/과거 검토 hash는 변경하지 않았다.

개발 생성기는 기존 검증된 모듈3개를 유지하고 별도 설치 transaction에 heartbeat를 포함한다. rollback/resume marker의 대상 ref만 개발 값으로 변환하며 base manifest/source/template/generator/output hash를 기록한다. 생성/check는 DB를 호출하지 않는다. 로컬 생성 검사는8개 통과했다.

```sh
node poc/v2-cloud/development/build.mjs check
node poc/v2-cloud/development/build.test.mjs
```

**이미 설치했으므로 install.sql을 다시 실행하지 않는다.** 생성 검사의 통과는 재설치 권한이나 새 SQL 검토 완료를 의미하지 않는다. 현재 개발 PK/자산 한도 등은 기존 최소 PoC 범위이며 제품 전체 서버/이미지 최적화의 완성 스키마가 아니다.

## 중지·되돌리기

먼저 실제 dev ref/현재 job을 확인한다. KeepAlive만 중지할 때는 검토된 개발 관리 연결에서 아래 쿼리를 선택 실행한다. 자동으로 실행하지 않았다.

```sql
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname='keepalive_ping' AND username=current_user;
```

이 명령은 heartbeat 테이블/마지막 시각/모듈 자료를 삭제하지 않는다. 공유 확장 pg_cron을 DROP하지 않는다. 중복 실행 방지용 재등록은 기존 command/schedule·객체 구조 확인 후 별도 변경 절차로 수행한다. 과거 install.sql 전체 재실행으로 처리하지 않는다.

개발 bundle의 rollback은 기존 모듈6개가 모두 빈 경우에만 제거하는 원칙을 유지한다. **모듈 rollback은 heartbeat/cron을 제거하지 않는다.** heartbeat 중지는 위 절차와 별도로 선택한다. 모듈에 자료가 생겼다면 pause/보존 후 복구·이관을 검토한다. 임의 TRUNCATE/DROP CASCADE는 없다.

## 비용·남은 조건

개발 조직/entitlements 조회는 새 토큰으로도403이어서 Free/계정별 quota는 독립 검증하지 못했다. 공개 무료 한도나 운영 예정의0.026GB 값을 개발 공식 잔여량으로 기록하지 않았다. 이번 적용은 기존 개발 프로젝트 안의 SQL/확장/cron 등록이며 Pro·compute 확장·유료 서비스·결제 설정을 변경하지 않았다. 공개문서의 Free 기준/실제 콘솔 확인과 현재 소비량 추적은 여전히 별도 항목이다.

다음은 개발 플랜/Usage 확인, 정규 일일 job 첫 실행 추적, 개발 gateway/Auth/private 자산 검증이다. Blob 공급자 선택(R2/Supabase 등)·키·버킷·파일 실험은48문서 조건에 따라 별도로 진행한다. KeepAlive 때문에 V1 또는 로컬 전용판이 네트워크를 호출하지 않는다.

[설치 응답](evidence/development-db-install.json) · [모듈 검증](evidence/development-db-verification.json) · [스케줄러 검증](evidence/development-keepalive-verification.json) · [설치 전 점검](evidence/development-install-prechecks.json) · [소유자](evidence/development-install-owner.json)
