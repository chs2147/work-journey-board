# Work Journey Board 웹 · W1 DEV

[웹 서비스 설계](../docs/web-service-v1-spec.md)의 W1 구현입니다. 기존 DEV 계정의 이메일 인증번호, 웹 약관 동의, 기기 등록, 온라인 공간 목록, 현재 브라우저 로그아웃을 제공합니다. 공간의 일지 열기·수정은 W2 범위입니다. 이용약관과 개인정보 처리방침은 DEV 검토 문안입니다.

## 실행과 검증

저장소 루트에서 Node.js 24로 실행합니다. 테스트는 가상 이메일과 가상 공간으로 Supabase HTTP 계약을 실행하며, 실제 메일을 발송하지 않습니다. 시스템 Chromium이 있다면 화면과 두 탭의 세션 흐름도 시험할 수 있습니다.

```sh
npm ci
node --test web/w1.test.mjs
WJB_TEST_CHROMIUM=/usr/bin/chromium node --test web/w1.test.mjs
docker build -f web/Dockerfile -t wjb-web-dev:w1 .
```

DEV 환경에서 아래 값을 주입하고 `node web/server.mjs`로 실행합니다. 브라우저를 이용한 로컬 연결은 `http://127.0.0.1:8080`, 호스팅은 실제 DEV HTTPS 주소로 설정합니다.

| 환경변수 | 값 |
| --- | --- |
| `WJB_SUPABASE_DEV_PROJECT_REF` | 데스크탑 DEV와 같은 Supabase 프로젝트 참조값 |
| `WJB_SUPABASE_DEV_PUBLISHABLE_KEY` | 해당 DEV 프로젝트의 `sb_publishable_` 키 |
| `WJB_WEB_ORIGIN` | 브라우저가 사용하는 정확한 출처, 마지막 슬래시 없음 |
| `WJB_WEB_REDIS_REST_URL` | DEV Redis REST의 HTTPS 루트 주소 |
| `WJB_WEB_REDIS_REST_TOKEN` | 해당 DEV Redis의 읽기·쓰기 토큰 |
| `WJB_WEB_SESSION_KEY` | Base64로 인코딩한 32바이트 무작위 키. 인스턴스 간 동일한 값 사용 |
| `PORT` | 호스트에서 전달하는 HTTP 포트. 기본값 8080 |

세션 키와 Redis 토큰은 Secret Manager로 주입합니다. 키 교체 시 기존 웹 세션과 동의 기록의 암호 해제가 불가능하므로, 실제 서비스 전에 별도의 키 관리와 동의 보관 방식을 확정합니다. W1 Redis REST는 단일 명령 배열 요청과 `SET`의 `EX`·`NX`·`KEEPTTL`, `GETDEL`, `EVAL`을 지원해야 합니다. 세션·챌린지·요청 제한·DEV 동의는 같은 저장소를 사용합니다.

## Cloud Run 리허설

1. DEV GCP 프로젝트, 서울 리전(`asia-northeast3`)의 Cloud Run·Artifact Registry, DEV Redis REST 저장소와 브라우저 접근용 HTTPS 주소를 준비합니다. 리전과 세션 저장소 공급자는 운영 검토에 기록합니다.
2. 위 Dockerfile로 만든 이미지를 DEV Artifact Registry에 올립니다. Cloud Run 서비스에 인증을 요구하고, IAP 등으로 검증 참가자만 브라우저에서 접근하게 설정합니다. 환경변수는 DEV 값으로 채우고 공개 진입점은 별도 출시 시점에 연결합니다.
3. `/healthz`의 DEV 응답과 `/login`, `/terms`, `/privacy`를 확인합니다. 등록된 테스트 이메일 두 개로 로그인하여 각자 소유한 가상 공간만 표시되는지 확인합니다. 등록되지 않은 테스트 이메일 요청은 같은 화면 문구를 표시하고 Supabase 계정이 생기지 않아야 합니다.
4. 두 탭 새로고침, 1시간 뒤 토큰 갱신, 로그아웃, 운영자 회수 뒤 다음 공간 목록 요청을 확인합니다. 같은 DEV 데스크탑 로그인과 공간 데이터가 유지되는지도 비교합니다.
5. 호스트 및 Redis 리전, 로그 보관 기간, 검증 결과를 확정한 뒤 검토 문안과 티저의 웹 진입 링크를 출시 범위에 반영합니다.

[Cloud Run 컨테이너 배포](https://cloud.google.com/run/docs/deploying) · [Cloud Run IAP](https://cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run) · [Secret Manager 설정](https://cloud.google.com/run/docs/configuring/services/secrets)
