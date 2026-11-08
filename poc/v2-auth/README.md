# V2 인증 검증 PoC

독립 Node PoC로, 앱과 의존성/실행 경로를 공유하지 않는다. `jose@6.2.15`를 별도 package/lockfile에 고정했다(MIT). `createLocalJWKSet`·`jwtVerify`를 사용하며 이 코드 자체는 네트워크 요청을 하지 않는다. 설치 시 npm registry 접근은 필요하다. 실제 서버용 JWKS 다운로드/캐시·키 교체 재조회는 후속 어댑터다.

```sh
npm ci --prefix poc/v2-auth --ignore-scripts --no-audit --no-fund
npm test --prefix poc/v2-auth
PYTHONDONTWRITEBYTECODE=1 python3 poc/v2-postgres/run-local.py --extended
```

서명 검증28개는 실행 시 생성한 가상 ES256 키/토큰으로 수행한다. 개인 키/토큰을 저장하지 않는다. `principal-fixture.mjs`는 동일 검증기를 거친 가상 principal만 출력해 PostgreSQL 기기 등록 시험에 연결한다. 실제 사용자 로그인/토큰으로 오해하지 않는다.

서버 설정에서 project ref와 공개 JWKS를 받고 issuer는 해당 ref로 고정한다. 토큰 안의 URL/키를 가져오지 않는다. ES256·kid·JWT typ·issuer/audience·만료/발급시각/nbf·sub/session UUID·authenticated 역할을 확인한다. anonymous/service-role 토큰을 거절한다. PoC의 최대 수명1시간/시계 오차0초는 시험 정책이며 제품 운영값은 별도다.

유효한 서명 이후에도 `sessionIsActive(principal)`가 명시적으로 true를 반환해야 한다. false/오류/불명 상태는 접근을 거절한다. **현재 시험의 callback은 가상 함수이므로 실제 Supabase 세션의 만료/로그아웃·회수를 확인한 것은 아니다.** 토큰의 서명 유효성과 현재 세션의 활성 상태를 분리한다. 운영에서 항상 true인 callback으로 대체하면 안 된다.

반환값은 최소 principal이고 오류는 고정 code만 포함한다. 토큰·서명 키·원래 예외 상세는 반환/로그에 넣지 않는다. 공개 JWKS를 조회한 사실과 로컬 가상 토큰 검증 결과는 별도 증거다. 실제 메일·PKCE/native callback·refresh 저장소·Auth 서버 연결·클라우드 배포는 범위 밖이다.

상세 결과와 남은 인증 경계는 [34문서](../../docs/v2-design/34-auth-private-assets-results.md)를 따른다.
