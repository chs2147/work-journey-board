# 99. G-3 개발 전용 잠금 → 서버 허용 목록(개발·운영)

2026-11-17 · 브랜치 `v2-g-stage` · 97문서 G-3 · 결정 G-D2(운영 = `hutqsfftioxtredcjhsy`)

## 0. 원칙

- 서버 쪽·앱 쪽 모두 **받는 프로젝트는 개발·운영 둘뿐**(그 밖은 거절). 표는 한 곳씩: 서버 = `poc/v2-cloud/cloud-environment.mjs` `CLOUD_TARGETS`, 앱 = 격리 라이브러리 `CloudTarget`(같은 두 ID) + `src-tauri/src/online.rs` 서버 표.
- **판마다 서버 하나**: Connected Preview·DEV = 개발. 정식판은 아직 온라인 없음(G-9에서 운영). 섞이지 않게 앱은 판에서 서버를 고르고, gateway는 자기가 돌고 있는 프로젝트로만 요청한다.
- 운영 프로젝트에는 아직 접속·배포하지 않는다(G-2 승인 전). 앱의 운영 서버 줄은 공개 키가 비어 있어(`SERVER_NOT_READY`) 고를 수 없다.

## 1. 앱(Rust)

| 항목 | 내용 |
|---|---|
| 서버 표 | `Server { env, project_ref, origin, publishable_key }` — `DEVELOPMENT`(공개 키 있음), `PRODUCTION`(공개 키 없음 = 준비 전) |
| 확인 | `Server::check()`: ID가 `CloudTarget` 허용 목록과 맞는지 → 주소 = `https://<ID>.supabase.co` → 공개 키 `sb_publishable_` 형식·있음. 아니면 `SERVER_NOT_ALLOWED`·`SERVER_ORIGIN_MISMATCH`·`SERVER_KEY_INVALID`·`SERVER_NOT_READY` |
| 판 → 서버 | `server_for`: Preview·DEV → 개발, 정식판 → `NO_ONLINE_SERVER` |
| 사용 | 계정·gateway·이관 요청은 모두 `endpoint()`(요청마다 확인, 패닉 없음). 이 기기 자료 위치·보안 저장소 범위는 그 서버의 `CloudTarget`(위치가 `<환경>/<ID>`로 나뉨) |
| 요청 표시 | `User-Agent: WorkJourneyBoard/<판>`(판 종류·계정 없음) |
| 시험 | 검증판 = 개발만, 운영 = 목록에는 있으나 준비 전, 개발 ID+운영 표시·개발 ID+운영 주소·예전 키 형식·목록 밖 ID 거절 |

## 2. 서버(gateway)

| 항목 | 내용 |
|---|---|
| 모듈 | 이관(`server-rpc`)·읽기(`read-rpc`)·동기화(`sync-rpc`)·계정(`account-rpc`)·조립(`development-gateway`)이 개발 ID 하나 대신 `isAllowedProjectRef`(개발·운영). 주소는 받은 ID에서만. 오류 코드 `DEV_SERVER_TRANSPORT_REQUIRED` → `SERVER_TRANSPORT_REQUIRED` |
| Edge 진입점 | `runtimeProjectRef(SUPABASE_URL)` — 정확히 `https://<허용 ID>.supabase.co`만(다른 호스트·경로·http 거절). 그림 버킷 = 환경마다 하나(`wjb-v2-dev-assets` / 운영 `wjb-v2-assets` — G-2에서 만듦) |
| 배포 | 배포 도구는 지금처럼 개발만(`--deploy-development`). 운영 배포는 G-2 절차서·승인 뒤 |
| 시험 | 허용 목록·환경 이름·`SUPABASE_URL` 판별(악성 호스트·경로·http·내부 주소 거절), 모듈마다 목록 밖 거절·운영 받음(운영이면 운영 주소로만) |
| 적용 | 개발 서버 gateway **v15** 배포(2026-11-17) — 로그인 없이 `/v2/me` → 401 `AUTH_REQUIRED`(시작 단계 통과) |

## 3. 남은 것

- G-4: 서버 전용 열쇠 새 형식(`sb_secret_`) — 지금 모듈은 예전 형식만 받는다.
- G-2: 운영 공개 키를 앱 표에 넣고, 운영 판(정식판 온라인) → 운영 서버 줄을 `server_for`에 더한다(그때 시험이 함께 바뀜).
