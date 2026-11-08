# 34. 인증 검증·기기 회수·비공개 자산 로컬 시험

2026-11-08 · `v2-design` · 실제 클라우드 쓰기 없음

## 수행 결과

사용자의 다음 단계 요청으로 [33문서](33-local-postgres-results.md)의 최소 서버 SQL을 확장했다. 기존 앱1.23.0·DB18·main·Supabase 설정은 유지했다.

| 범위 | 결과 | 증거/한계 |
|---|---|---|
| 실제 프로젝트 공개 JWKS | GET200, 공개 EC/ES256 키1개 | [조회 요약](evidence/project-jwks-summary.json). 사용자 토큰/로그인은 미사용 |
| 로컬 JWT 서명/claim 검증 |28개 PASS | [시험 증거](evidence/local-auth-assets-pass.json). 실행 중 생성한 가상 키/토큰 |
| 로컬 PostgreSQL |88개 PASS = 기존39 + 신규49 | [SQL 증거](evidence/local-postgres-assets-pass.json). 기기 등록/회수·자산 상태/권한·경쟁 포함 |
| 실제 Auth/Storage | 미실행 | 메일·사용자 생성·native PKCE·실제 파일 전송/Storage policy 검증 아님 |

## 인증 검증과 서버 경계

[독립 인증 PoC](../../poc/v2-auth/README.md)는 `jose@6.2.15`를 별도 package/lockfile에 고정한다. 앱의 dependency/lockfile은 변경하지 않았다. 공개 키를 메모리에서 조회하는 검증 경로 자체에는 네트워크 요청이 없다. 인증 로직을 직접 암호 알고리즘으로 구현하지 않고 라이브러리의 JWT 검증을 사용했다.

서버 설정의 project ref에서 issuer를 고정하고 공개 JWKS만 받는다. ES256·서명·kid·JWT 유형·issuer·authenticated audience·발급/만료/nbf·주체/세션 UUID·역할을 확인한다. 토큰에 담긴 jku/jwk/x5u를 사용하지 않으며, private key/중복 kid를 포함한 설정은 거절한다. 변조·다른 키·unsigned/HMAC 혼동·오래되거나 미래인 토큰·잘못된 유형·service-role/anonymous·알 수 없는 kid를 시험했다. 신뢰한 새 키 추가/이전 키 제거도 로컬 키 집합으로 시험했다.

서명이 유효해도 `sessionIsActive`가 true여야 한다. 세션 조회 실패는 AUTH_UNAVAILABLE, 회수/비활성은 ACCESS_REVOKED로 닫힌다. 이 callback은 현재 가상 함수다. 실제 Supabase 세션 조회·JWKS 캐시/키 교체 재조회·HTTP 인증 미들웨어까지 구현 완료로 해석하지 않는다. PoC의 최대 토큰 수명1시간과 시계 오차0초도 확정 운영 정책이 아니다.

실제 연계 시의 경계는 다음과 같다.

1. 고정 프로젝트의 JWKS를 신뢰한 서버 경로로 읽고 캐시한다. 토큰이 지정한 URL을 사용하지 않는다. unknown kid에는 제한된 재조회/속도 제한을 적용하고 실패 시 거절한다. HS256 fallback으로 검증을 우회하지 않는다.
2. 라이브러리로 서명/claim을 검증한 뒤, 제공자의 **현재 세션 활성 상태와 제품 회수 장부**를 확인한다. `/user` 호출 성공만으로 로그아웃된 세션까지 살아 있다고 판정하지 않는다. 대상 Auth 버전의 세션 조회·만료/회수 의미를 확인하고, 서버 전용 조회로 subject/session을 함께 대조한다.
3. 이 principal에서만 DB의 trusted claims를 구성한다. HTTP body의 userId/sessionId/role을 복사하지 않는다. 클라이언트에는 SQL 접속·service-role·세션 확인 함수를 개방하지 않는다. 현재 로컬 관리자는 가상 claims를 직접 지정하므로 이 gateway 보안을 증명하지 못한다.
4. 실제 메일/PKCE·native callback·refresh/keychain/credential store·세션 폐기 경합을 각각 검증한다. 현재 localhost:3000 설정을 추측한 native callback으로 덮어쓰지 않는다.

## 기기 등록·앱 세션 회수

새 SQL은 계정별 advisory lock으로 기기 등록과 현재 앱 세션 회수를 직렬화한다. 기기는 user/session에 고정되고 다른 계정/새 세션이 기존 deviceId를 조용히 재사용할 수 없다. 등록 재시도는 같은 바인딩에만 성공한다.

현재 세션 회수는 해당 세션을 차단 장부에 남기고 연결된 모든 기기를 비활성화한다. 같은 세션의 토큰으로 다른 deviceId를 만들어 회수를 우회하지 못한다. 등록/회수의 동시 실행과 회수 후 읽기/확정 거절을 시험했다. 새로 인증된 다른 세션은 새 기기를 등록할 수 있다. 이는 **제품 서버의 세션 차단**이며 Supabase refresh token을 실제 폐기한 시험이 아니다. 다른 기기 원격 회수/재인증 UX는 후속이다.

로컬 가상 ES256 토큰→검증 principal→DB 기기 등록도 연결했다. 이 흐름의 세션 활성 callback과 Auth SQL 함수는 여전히 가상이며 실제 Supabase 사용자 인증으로 기록하지 않는다.

## 비공개 자산 상태·용량

자산은 `reserved → ready` 또는 `reserved → canceled`로 전이한다. 공간/assetId와 서버가 생성할 경로의 대응을 전제로 하고 클라이언트 경로 문자열을 받지 않는다. 예약은 generation·기기·예상 SHA256/bytes에 고정된다. 본문/크기 변경 재시도·취소 ID 재사용을 거절한다.

**자산 바이트는 로컬 PostgreSQL bytea 시험 테이블에 둔다. 실제 Supabase Storage 구현이 아니다.** 신뢰한 저장 worker 역할을 시험 소유자 연결로 모사하고 client의 직접 stage 호출/테이블 쓰기는 거절한다. 저장된 바이트는 재업로드로 바꿀 수 없다. 예약/업로드 중에는 소유자에게도 metadata/bytes를 노출하지 않는다.

확정 시 서버가 실제 bytes의 크기·SHA256을 확인한다. 누락·해시/크기 불일치·만료·다른 generation·다른 기기를 거절한다. ready 갱신 뒤 주입 오류가 나면 공개 상태도 rollback되어 재시도 가능하다. ready만 RLS로 읽을 수 있고 다른 계정·회수 세션·다른 generation에는 숨긴다.

로컬 표본은 파일64KiB·공간1MiB·예약5분으로 제한했다. 이 값은 무료 제품 quota 확정값이 아니다. 미완료 예약도 용량에 포함하고 명시적 취소가 bytes를 정리해 용량을 반환한다. 만료만으로 자동 용량 반환하지 않는다. workspace 잠금으로 동시 예약이 한도를 넘지 않게 시험했다. 실제 객체 저장소와 DB 간 분산 확정·서명 URL 만료/회수·업로드 토큰 발급·이미지 MIME/디코딩·문서 참조·GC/보존 정책은 후속이다.

## 재현·남은 순서

```sh
npm ci --prefix poc/v2-auth --ignore-scripts --no-audit --no-fund
npm test --prefix poc/v2-auth
PYTHONDONTWRITEBYTECODE=1 python3 poc/v2-postgres/run-local.py --extended
```

Docker의 로컬/네트워크 차단·자원 제한·실행 종료 정리 규칙은 기존 PoC와 같다. 최종 증거의 파일 hash에는 SQL/Python과 독립 Auth 소스/lockfile을 포함한다. 제품 소스/기존 SQLite 모형은 바뀌지 않아 그214개를 재실행하지 않았다. 이 단계의 성공을 P01~P22 전체 환경 통과로 합산하지 않는다.

다음은 실제 Auth·Storage 적용에 사용할 **gateway/세션 확인 방식·클라우드 역할/스키마·bucket/policy·시험 표본·복구 절차**를 검토 가능하게 만드는 것이다. 로컬 bytea 모형을 그대로 온라인 저장소로 배포하지 않는다. 적용 전 Usage 잔여량·메일/콜백 조건을 확인하고, 현재 읽기 토큰에 쓰기 권한을 자동 추가하지 않는다.
