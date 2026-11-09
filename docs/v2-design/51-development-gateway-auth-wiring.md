# 51. 개발 gateway·인증 연결 구성과 서버 키 준비

2026-11-09 KST · v2-design · 앱1.23.3/로컬 DB18 유지

## 이번 결과

개발 DB 설치 다음 단계로 development-gateway 조합을 구현했다. [공개 JWKS](evidence/development-auth-public-check.json)는 실제 개발 프로젝트GET200/EC P-256/ES256을 확인했다. 실제 로그인·Auth 사용자 생성·Storage bucket/파일 전송·gateway 공개 배포는 하지 않았다. KeepAlive 작업/운영 예정 DB/환경 재게시는 변경하지 않았다.

[development-gateway.mjs](../../poc/v2-gateway/development-gateway.mjs)는 dev ref만 허용하고 JWT issuer→서버 세션 RPC→영속 metadata RPC→자산 handler/복구 worker를 같은 대상에 연결한다. factory는 env/JWKS 자동 조회·listen·배포를 수행하지 않으며 trusted transport/server key/JWKS를 명시적으로 받아야 한다.

기존 supabase-rest adapter는 등록된 dev/prod2개 ref만 지원하도록 확장했다. 기존 고정 prod fixture는 유지하며 개발 factory에서는 prod 구성을 거절한다. 임의 ref/클라이언트 URL은 허용하지 않는다. 요청은 선택된 origin에만 credential을 전달하고 redirect를 따르지 않는다. 일반 환경의 Management PAT를 runtime key 대신 자동 사용하지 않는다. sbp_ 형태 PAT와 아직 검증하지 않은 sb_secret_ 모드를 개발 factory가 명시적으로 거절한다.

## 검증 범위

| 검사 | 결과 |
|---|---|
| 신규 개발 조합 |10개 통과. 실제 loopback HTTP 요청+가상 ES256 서명·상류 REST 대체 transport |
| 기존 HTTP gateway |61개 통과 |
| metadata adapter |14개 통과 |
| 복구 worker |25개 통과 |
| JWT/세션 adapter |28개+11개 통과 |

새 검사에서 개발 issuer 정상 흐름·운영 issuer 거절·회수 세션·이상한 RPC 응답·무인증·Origin 거절·자격증명 미지정/잘못된 종류를 확인했다. 실제 Supabase 로그인/RPC/Storage의 끝까지 검증한 결과는 아니다. [통합 기록](evidence/development-gateway-pass.json)에 실행 파일과 log hash를 보존한다. 원래의 Docker 영속 통합41개는 이번 작업에서 다시 실행/합산하지 않았다.

```sh
node poc/v2-gateway/development-gateway.test.mjs
node poc/v2-gateway/gateway.test.mjs
node poc/v2-gateway/postgres-metadata.test.mjs
node poc/v2-gateway/recovery.test.mjs
npm test --prefix poc/v2-auth
```

## 사용자 직접 설정: 개발 서버 runtime key

현재 등록된 것은 DEV/PROD **Management API 토큰**이다. 이는 DB 준비/설정용이며 서버의 Auth/REST RPC 자격증명과 용도가 다르다. 현재 실제 환경과 설정 초안을 확인했으며 DEV_SERVICE_ROLE_KEY 항목/값이 없었다. 관리 API에서 키를 추출하거나 기존 비밀을 복사하지 않았다.

기존 항목은 유지한 채 다음 **비밀 요구 항목만** 초안에 추가했다. 저장은 확인됐고 실제 값 입력/환경 적용/게시를 대신하지 않는다.

| 항목 | 값/작업 |
|---|---|
| Secret 이름/주입 변수 | WJB_SUPABASE_DEV_SERVICE_ROLE_KEY |
| 값 출처 | 개발 프로젝트 vsphftnmfzfoufasjttd의 API Keys → Legacy anon/service_role API keys에서 **service_role** 키 |
| 허용 목적지 | vsphftnmfzfoufasjttd.supabase.co 하나 |
| Secret source | 사용자 비밀 입력(user_provided) |
| 제공하면 안 되는 대체값 | anon/publishable 키, Management PAT, 운영 service_role, DB 비밀번호 |

Supabase 프로젝트의 API Keys 화면에서 legacy service_role을 확인해 환경 설정의 Secret 입력에 저장하고 적용/게시 후 알려준다. 키는 채팅·Git·앱 번들에 넣지 않는다. 새 sb_secret_ 방식은 현재 어댑터의 Authorization 처리와 다르므로 몰래 호환된다고 간주하지 않는다. legacy 키를 사용할 수 없다면 새 키 transport를 별도 검증한 뒤 입력 계약을 조정한다. 운영 runtime Secret은 요청하지 않았다.

현재 factory는 호출자가 명시적으로 설정을 공급한다. 이 Secret만 등록한다고 gateway가 자동 배포되거나 인터넷에 공개되지 않는다. 실제 transport/JWKS 재조회·키 rotation/native 로그인·호스팅은 남은 단계다.

## 다음 실제 검증

1. Secret 적용 후 새 readiness/DEV ref/키 종류 확인. 비밀값은 출력하지 않는다.
2. 새 개발 서버 키로 실제 세션 RPC의 가상 UUID 거절/권한을 확인한다. 인증 없는 호출 차단과 실제 PostgREST 경계도 시험한다.
3. 개발 가상 계정/기기를 사용해 실제 Auth 로그인·세션 회수·사용자/공간 격리를 검증한다. 테스트는 메일 발송 없는 fixture 경로부터 검토한다.
4. Blob 공급자는48문서에 따라 별도로 선택한다. 이번 Supabase REST 계약 fixture 지원이 Supabase Storage 최종 채택을 뜻하지 않는다. 실제 bucket/파일은 공급자/무료 잔여량·시험 범위를 확정한 뒤 만든다.

현재 최소 자산 PoC는64KiB·assetId 경로/전용 테스트 bucket 계약이다.46문서의 제품용 이미지 최적화/공유 blob/dedup가 구현됐다는 뜻이 아니다. 현재 키 미설정 상태에서 실제 cloud auth/file 검증을 완료로 올리지 않는다.
