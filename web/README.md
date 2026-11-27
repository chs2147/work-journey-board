# Work Journey Board 웹 · W1 DEV

웹은 로그인한 DEV 계정의 온라인 워크스페이스 목록을 표시합니다. Vercel은 웹 화면과 API를 실행하고, 기존 Supabase DEV는 초대 전용 이메일 인증, 온라인 공간과 웹 세션을 제공합니다. 공간의 일지 열기·편집은 W2 범위입니다. [상세 설계](../docs/web-service-v1-spec.md)

## 로컬 빌드

저장소 루트에서 Node.js 24로 실행합니다.

```sh
npm ci
npm ci --prefix web
npm run build --prefix web
```

웹 빌드는 `web/.vercel/output`에 서비스 산출물을 만듭니다. 현재 웹 기능에 필요한 코드, PostgreSQL 드라이버, 기존 아이콘·워드마크만 패키징합니다. 로컬 서버는 아래 환경변수를 준비한 뒤 `npm start --prefix web`으로 실행합니다.

## Supabase DEV 준비

기존 Supabase DEV에는 마이그레이션 `20261127113752`가 적용되었습니다. 같은 프로젝트를 사용하면 마이그레이션 이력을 확인하고 전용 역할의 접속 정보 설정부터 진행합니다.

1. 기존 데스크탑 DEV와 같은 프로젝트에서 백업과 적용 대상을 확인합니다. DB 소유자 권한으로 [W1 마이그레이션](supabase/migrations/20261127113752_wj_web_sessions.sql)을 적용합니다. `wj_web` 비공개 스키마와 제한된 로그인 역할 `wj_web_app`이 생성됩니다.
2. DEV DB 관리 연결에서 `psql`의 `\password wj_web_app`로 새 비밀번호를 설정합니다. Supabase Dashboard **Connect → Transaction pooler**의 호스트와 포트 `6543`을 사용하고, 사용자 이름은 `wj_web_app.<DEV 프로젝트 참조값>`으로 구성합니다. Database Settings의 SSL Configuration에서 해당 프로젝트의 CA 인증서를 내려받습니다.
3. 역할로 접속해 `wj_web` 접근을 확인합니다. `anon`과 `authenticated`의 스키마 접근 및 웹 역할의 온라인 원장 직접 접근은 차단되어야 합니다. `cron.job`에서 `wj-web-expiration`이 등록됐는지 확인합니다.

| 환경변수 | 설정 값 |
| --- | --- |
| `WJB_SUPABASE_DEV_PROJECT_REF` | 기존 데스크탑 DEV와 동일한 Supabase 프로젝트 참조 |
| `WJB_SUPABASE_DEV_PUBLISHABLE_KEY` | 같은 DEV 프로젝트의 `sb_publishable_` 키 |
| `WJB_WEB_ORIGIN` | 끝 슬래시를 뺀 정확한 웹 출처. 로컬 예시는 `http://127.0.0.1:8080` |
| `WJB_WEB_DATABASE_URL` | 전용 역할의 Transaction pooler URI. 비밀번호는 URL 인코딩하며 URI 쿼리 문자열 없이 저장 |
| `WJB_WEB_DB_CA` | DEV Supabase에서 내려받은 CA 인증서의 PEM 전체 텍스트. 로컬 평문 테스트에서만 생략 |
| `WJB_WEB_SESSION_KEY` | Base64 32바이트 세션 키. `openssl rand -base64 32`로 생성하고 배포 간에 유지 |

DB 접속 URI와 세션 키는 Vercel Preview의 **Sensitive** 환경변수로 등록합니다. 키를 변경하면 웹에서 다시 로그인합니다. 인증과 공간 권한 조회에는 기존 사용자 세션과 게이트웨이를 사용합니다. [Supabase DB 연결](https://supabase.com/docs/guides/database/connecting-to-postgres) · [Supabase Cron](https://supabase.com/docs/guides/cron)

## Vercel Preview

1. Vercel 프로젝트에서 **Root Directory**를 `web`, **Framework Preset**을 **Other**, **Node.js Version**을 **24.x**로 지정합니다. **Include source files outside of the Root Directory in the Build Step**을 활성화해 저장소의 로고와 DEV 대상 정의를 웹 빌드에 전달합니다.
2. W1 프로젝트의 Git 빌드 범위를 `web-service-v1` Preview로 제한합니다. **Deployment Protection**에서 Preview에 Vercel Authentication을 적용하고, **System Environment Variables**를 활성화합니다. 위 환경변수는 `web-service-v1` Preview에 연결합니다. 브라우저는 `WJB_WEB_ORIGIN`에 등록한 주소로 접속합니다.
3. `web-service-v1`의 Preview를 배포합니다. Deployments의 Source 커밋과 `/healthz`의 `revision`을 대조하고, `app`이 `work-journey-board-web`인지 확인합니다.
4. Vercel 접근 인증을 통과한 뒤 제품 로그아웃 상태에서 `/`, `/spaces`, `/app/…`가 `/login`으로 이동하는지 확인합니다. `/api/spaces`는 `401`을 반환해야 합니다. 약관과 개인정보 처리방침은 제품 로그인 전에도 열립니다.
5. 등록된 DEV 테스트 계정 두 개로 실제 메일을 받아 서로 다른 브라우저 프로필에서 로그인합니다. 자기 온라인 공간만 표시되는지, 공간 0개일 때 빈 목록이 나오는지, 웹의 두 탭에서 로그아웃이 반영되고 데스크탑 DEV의 세션이 유지되는지 확인합니다. 미등록 이메일 요청은 일반 안내를 표시하고 Supabase 계정이 생성되지 않아야 합니다.

[모노레포 설정](https://vercel.com/docs/monorepos) · [Build Output API](https://vercel.com/docs/build-output-api) · [Preview 보호](https://vercel.com/docs/deployment-protection)

## 로컬 통합 테스트

로컬 폐기용 `wj_web_test` DB에 `anon`, `authenticated` 역할과 최소 `auth.users(id uuid primary key)`를 만듭니다. 테스트 계정 UUID `11111111-1111-4111-8111-111111111111`, `33333333-3333-4333-8333-333333333333`를 등록하고 마이그레이션을 적용합니다. 테스트 비밀번호를 설정한 `wj_web_app` 접속 URI를 `WJB_WEB_TEST_DATABASE_URL`로 제공한 뒤 아래 명령을 실행합니다. 인증과 게이트웨이는 가상 이메일·데이터로 시험합니다.

```sh
node --test web/w1.test.mjs
WJB_TEST_CHROMIUM=/usr/bin/chromium node --test web/w1.test.mjs
```
