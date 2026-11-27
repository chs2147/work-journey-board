# Work Journey Board 웹 · W1 DEV

[웹 서비스 설계](../docs/web-service-v1-spec.md)의 W1 구현입니다. 기존 DEV 계정의 이메일 인증번호, 웹 약관 동의, 기기 등록, 온라인 공간 목록, 현재 브라우저 로그아웃을 제공합니다. 공간의 일지 열기·수정은 W2 범위입니다. 이용약관과 개인정보 처리방침은 DEV 검토 문안입니다.

## 배포 설계 개정

웹 배포는 온라인 계정 전용으로 재설계했습니다. Vercel 웹 전용 진입점과 기존 Supabase의 비공개 Postgres 세션 저장소를 사용합니다. 현재 브랜치 구현은 초기 Redis 기반 W1이며, 아래 명령과 설정은 기존 구현을 로컬에서 검증할 때 적용합니다. Supabase 세션 전환과 Vercel 진입점 분리의 배포 기준은 상세 설계서에 있습니다. [서비스·데이터 설계](../docs/web-service-v1-spec.md#5-서비스데이터-설계) · [웹 전용 배포](../docs/web-service-v1-spec.md#웹-전용-배포-진입점과-기존-배포-점검)

## 기존 W1 로컬 실행과 검증

저장소 루트에서 Node.js 24로 실행합니다. 테스트는 가상 이메일과 가상 공간으로 Supabase HTTP 계약을 실행하며, 실제 메일을 발송하지 않습니다. 시스템 Chromium이 있다면 화면과 두 탭의 세션 흐름도 시험할 수 있습니다.

```sh
npm ci
node --test web/w1.test.mjs
WJB_TEST_CHROMIUM=/usr/bin/chromium node --test web/w1.test.mjs
docker build -f web/Dockerfile -t wjb-web-dev:w1 .
```

DEV 환경에서 아래 값을 주입하고 `node web/server.mjs`로 실행합니다. 브라우저를 이용한 로컬 연결은 `http://127.0.0.1:8080`, HTTPS 환경에서는 해당 DEV 주소로 설정합니다.

| 환경변수 | 값 |
| --- | --- |
| `WJB_SUPABASE_DEV_PROJECT_REF` | 데스크탑 DEV와 같은 Supabase 프로젝트 참조값 |
| `WJB_SUPABASE_DEV_PUBLISHABLE_KEY` | 해당 DEV 프로젝트의 `sb_publishable_` 키 |
| `WJB_WEB_ORIGIN` | 브라우저가 사용하는 정확한 출처, 마지막 슬래시 없음 |
| `WJB_WEB_REDIS_REST_URL` | DEV Redis REST의 HTTPS 루트 주소 |
| `WJB_WEB_REDIS_REST_TOKEN` | 해당 DEV Redis의 읽기·쓰기 토큰 |
| `WJB_WEB_SESSION_KEY` | Base64로 인코딩한 32바이트 무작위 키. 인스턴스 간 동일한 값 사용 |
| `PORT` | 호스트에서 전달하는 HTTP 포트. 기본값 8080 |

세션 키와 Redis 토큰은 로컬 실행 환경에서 주입합니다. 키 교체 시 기존 웹 세션과 동의 기록의 암호 해제가 불가능하므로, 실제 서비스 전에 별도의 키 관리와 동의 보관 방식을 확정합니다. W1 Redis REST는 단일 명령 배열 요청과 `SET`의 `EX`·`NX`·`KEEPTTL`, `GETDEL`, `EVAL`을 지원해야 합니다. 세션·챌린지·요청 제한·DEV 동의는 같은 저장소를 사용합니다.
