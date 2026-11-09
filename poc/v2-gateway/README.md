# V2 HTTP gateway·Storage REST 어댑터 PoC

기존 앱/DB18과 분리된 로컬 PoC다. **실제 Supabase에는 요청/배포하지 않는다.** `gateway.mjs`는 Web Request/Response handler, `supabase-rest.mjs`는 고정 프로젝트의 Storage/RPC HTTP 계약 어댑터다. transport를 서버 설정으로 명시해야 하며 환경 비밀을 읽거나 자동 접속하지 않는다.

```sh
npm ci --prefix poc/v2-auth --ignore-scripts --no-audit --no-fund
node poc/v2-gateway/gateway.test.mjs
```

시험은 임시 포트의127.0.0.1 HTTP 서버2개를 만들고 종료 시 닫는다. 하나는 gateway, 하나는 Supabase 형태의 REST 응답을 제공하는 **시험 대체 서버**다. transport는 고정된 Supabase URL인지 검사한 후 로컬 서버로만 전달한다. 실제 cloud credential 대신 가상 키/ES256 토큰을 쓴다. 환경이 localhost listen을 EPERM으로 막으면 지원되는 외부 실행 경로가 필요하다.

| 파일 | 역할 |
|---|---|
| `gateway.mjs` | Bearer 검증·예약/업로드/다운로드/취소·오류 정리 |
| `supabase-rest.mjs` | 고정 bucket·object path·upsert=false·인증 다운로드·삭제 후 부재 확인·세션 RPC |
| `io.mjs` | UUID/generation 검사, 제한된 bytes/길이/읽기 시간 |
| `node-server.mjs` | 명시적으로 listen해야 하는 로컬 시험 HTTP host. 배포/운영 서버 아님 |
| `fixtures.mjs` | 메모리 metadata·단일 프로세스 잠금·fault injection. **영속 DB 구현 아님** |
| `gateway.test.mjs` | 실제 로컬 HTTP를 통한61개 시험 |

루트 앱 dependency/lockfile을 바꾸지 않는다. Node 내장 모듈 및 기존 독립 Auth PoC의 `jose`만 사용한다. `test-jose.mjs`는 테스트가 의존 패키지의 내부 dist 경로를 직접 참조하지 않도록 공용 API를 재노출한다. 어댑터는 주입된 transport를 통해서만 HTTP를 호출하며, 향후 실제 transport를 연결하면 **서버에서만** 고정 Supabase 목적지로 통신한다.

handler는 Origin 요청을 기본 거절하고 cookie를 인증 수단으로 쓰지 않는다. 브라우저 CORS/native callback은 아직 지원하지 않는다. 파일은 최대64KiB 임의 bytes, JSON 최대2KiB, body 읽기/상류 요청은5초 제한이다. 다운로드 전까지 최대64KiB를 버퍼링하고 hash를 검증하므로 대형 파일/스트리밍 렌더링의 제품 설계가 아니다.

메타데이터 adapter는 예약 용량을 원자적으로 관리하고, asset의 쓰기·취소와 상태 확정을 직렬화하며, 대기 작업 뒤 권한/generation을 재검사해야 한다. 현재 fixture의 메모리 잠금은 다중 프로세스·재시작·장애 복구를 보장하지 않는다. 실제 PostgreSQL command/RPC·lease/fence와 연계하기 전에는 운영에 연결하지 않는다. 실제 bucket 정책/가용량 검증도 남아 있으므로 클라우드 준비 상태는 계속 BLOCKED다.

상태와 HTTP 계약·실행 증거는 [36문서](../../docs/v2-design/36-http-gateway-storage-results.md)를 따른다.

## PostgreSQL 영속 metadata 후속

`node poc/v2-gateway/postgres-metadata.test.mjs`는 adapter12개, `node poc/v2-gateway/durable.test.mjs`는 실제 로컬 SQL/두 gateway/Storage 대체 서버 통합25개를 실행한다. Docker 로컬 소켓과127.0.0.1 listen이 필요하며, PostgreSQL 고정 이미지와 실행별 전용 volume을 사용한다. 테스트 종료 때 자기 label을 확인한 컨테이너/volume만 지운다. 실제 Supabase credentials는 시험 환경에서 제거한다.

`postgres-metadata.sql`은 별도 검토 후보이며 cloud에 적용하지 않았다. C1 session guard와 서버 전용 RPC 역할을 전제로 한다. `postgres-metadata.mjs`는 짧은 명령으로 reservation/quota와30초 lease/fence, I/O intent/cleanup epoch를 관리한다. 불명확한 저장은 추측해 quota를 해제하지 않는다. 프로세스가 영구히 종료된 intent의 정리 worker는 후속이며, prototype의 경우 취소가 계속 CLEANUP_UNCERTAIN일 수 있다. 자산256개·intent64개 제한은 PoC용이다. [37문서](../../docs/v2-design/37-durable-gateway-metadata-results.md)에 상태·장애·실제 DB/Storage와의 경계를 기록했다.

## 보수적 복구 worker

`node poc/v2-gateway/recovery.test.mjs`는 복구25개, `node poc/v2-gateway/postgres-metadata.test.mjs`는 확장 adapter14개, `node poc/v2-gateway/durable.test.mjs`는 기존25개를 포함한 영속/복구41개를 실행한다. setup은 matching `postgres-metadata.sql`과 `recovery.sql`을 순서대로 설치하며 실제 Supabase에는 적용하지 않는다. 앞 단계의 개수는 해당 시점 기록이다.

`createRecoveryWorker`는 명시적인 `preview`와 `apply`만 제공하며 cron/실제 앱 UI를 설치하지 않는다. 최대8개/회 미리보기 후 같은 계획 hash/작업을 전달해야 실행한다. matching 파일은 미확정 intent를 보존한 채 ready 복구할 수 있다. 미확정 요청이 없는 경우에만 cleanup과 부재 재확인 후 quota를 반환한다. 불명확한 missing/corrupt/장애·다른 generation은 보류한다. 운영자 확인만으로 intent를 강제 settled로 바꾸지 않는다. SQL 완료 기록으로 응답 유실/worker 재시작의 중복 실행을 막는다. [38문서](../../docs/v2-design/38-recovery-worker-results.md)에 UI 계약과 제한을 기록했다.

## 개발 환경 조합 후속

development-gateway.mjs는 개발 ref에 JWT/세션·metadata·자산/복구 어댑터를 연결하는 서버 factory다. 가상 서명/대체 REST와 실제 loopback HTTP 신규10개 및 기존 회귀 검사를 통과했다. 공개 개발 JWKS는 조회했지만 runtime key 미설정으로 실제 Auth/RPC/Storage 전체 시험은 미완료다. [51문서](../../docs/v2-design/51-development-gateway-auth-wiring.md)에 설정·검증 범위를 기록한다. 기존 미적용 설명은 당시 범위이며, 개발 DB 모듈과 pg_cron 적용은50문서를 따른다.
