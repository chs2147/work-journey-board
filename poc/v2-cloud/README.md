# V2 클라우드 적용 검토 묶음

**검토 후보이며 현재 프로젝트에 적용하지 않았다.** 대상은 `hutqsfftioxtredcjhsy` 한 개, 도쿄, 초기 월0원이다. 전체 sync 서버나 앱 배포판이 아니다.

| 파일 | 용도 |
|---|---|
| `plan.json` | 고정 대상·비공개 버킷·서버 proxy·가상 표본2계정/2자산의 범위 |
| `inspect-target.sql` | 대상 SQL 연결에서 실행할 읽기 전용 메타데이터 확인안. 실제 프로젝트 미실행 |
| `session-guard.sql` | C1 세션 확인/회수 RPC 후보. 새 private schema와 서버 전용 wrapper만 생성 |
| `rollback-session-guard.sql` | 트래픽 중지/회수 장부 보존 후의 수동 C1 제거. CASCADE 없음 |
| `preflight.mjs` | 오프라인 준비 상태 확인. API/SQL/배포를 실행하지 않음 |
| `observations.example.json` | 미확인 값을 남긴 입력 틀 |
| `observations.current.json` | 현재 확인된 세션 정책과 미확인 항목. Usage/Gateway/Storage는 미확인 |
| `sql_tests.py` | 별도 PostgreSQL 실행기에서 Auth fixture·권한·회수·복구를 검증 |

```sh
node poc/v2-cloud/preflight.mjs poc/v2-cloud/observations.current.json
node poc/v2-cloud/preflight.test.mjs
npm ci --prefix poc/v2-auth --ignore-scripts --no-audit --no-fund
npm test --prefix poc/v2-auth
PYTHONDONTWRITEBYTECODE=1 python3 poc/v2-postgres/run-local.py --extended --cloud
```

현재 preflight는 **BLOCKED / 종료 코드2**가 정상이다. 사용량·대상 Auth 스키마·migration 소유자·실제 gateway/private Storage/복구 검토가 남아 있다. 입력은 운영자가 확인한 비밀 없는 관측값만 사용한다. JSON의 진위나 실제 계정 상태를 자동 검증하는 도구가 아니다. 모든 항목이 참이어도 `REVIEW_READY`만 반환하고 적용하지 않는다. 비밀값을 입력하지 않는다.

SQL은 Auth `sessions.id/user_id/not_after`, `users.id/banned_until/deleted_at`에 의존한다. 공식 소스 확인과 대상 프로젝트의 실제 스키마 확인은 별개다. 현재 세션 정책(timebox/inactivity0·single false) 전용이며 정책 변경 시 재검토한다. migration 실행자가 private definer 함수를 소유하므로 그 역할의 권한 검토가 필요하다. client에는 실행/테이블 접근 권한을 주지 않고, 서버의 service-role만 고정 RPC를 호출한다. service-role을 앱/브라우저에 넣지 않는다.

재적용은 기존 객체를 교체하지 않고 실패한다. rollback도 예상 밖 의존성에는 실패하며 기존 관계를 CASCADE로 제거하지 않는다. 실제 rollback 전에 gateway를 차단하고 회수 상태를 보존해야 한다. 확인 GUC는 운영자의 수동 절차 표시이며 프로젝트 식별이나 권한을 보장하는 장치가 아니다.

비공개 Storage는 전용 bucket·서버 proxy·예약/확정/취소 계약까지 설계했고 실제 API/policy 적용은 남아 있다. 로컬 bytea 모형을 Storage로 배포하지 않는다. 상세 적용/비용/복구 순서는 [35문서](../../docs/v2-design/35-cloud-application-review.md)를 따른다.
