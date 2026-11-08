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

## 전체 묶음 v2

이전 표의 C1 단독 파일과 별개로 `bundle/manifest.json`은 세션·metadata·recovery 전체 범위다. `node poc/v2-cloud/bundle.mjs build` → `check`는 파일 생성/해시 확인만 하고 SQL을 실행하지 않는다. source/생성기/템플릿/출력 변화와 예상 밖 SQL/JSON을 감지한다. generated 폴더의 SQL을 wildcard로 일괄 실행하지 않는다.

`install.sql`은3모듈을 한 transaction으로 설치한다. `verify.sql`은 ACL/RLS/search_path/소유자 확인, `preinstall.sql`은 비밀/본문 없는 사전 조회다. `pause.sql`은 자료를 남기고 server RPC만 중단하고, 검토 표시 후 `resume.sql`로 원래 권한만 복원한다. `rollback.sql`은6테이블을 잠근 뒤 모두 비었을 때만 제거하며 데이터가 있으면 거절한다. CASCADE/자료 purge는 없다.

`node poc/v2-cloud/preflight.mjs --bundle --phase=sql-install poc/v2-cloud/observations.current.json`은 DB-only 준비, 같은 명령에서 phase 옵션을 생략하면 실제 cloud 검증 준비를 평가한다. 현재 둘 다 BLOCKED다. gateway/Storage 검증은 SQL 선행 조건으로 순환 요구하지 않고 다음 단계로 명시한다. JSON은 확인 기록이며 사용자 승인/실계정의 진위를 자동 인증하지 않는다.

시험은 `node poc/v2-cloud/bundle.test.mjs`(29개), `node poc/v2-cloud/preflight.test.mjs`(23개), `PYTHONDONTWRITEBYTECODE=1 python3 poc/v2-postgres/run-local.py --bundle`(기존39+bundle34=73개)다. bundle SQL 시험 모드는 C1 단독 `--cloud` 모드와 섞지 않는다. 자세한 실제 관측과 검토 순서는 [39문서](../../docs/v2-design/39-full-bundle-review.md)를 따른다.
