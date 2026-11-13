# 79. B단계 — Preview 앱 ↔ 개발 DB 첫 연결 (진행 중)

2026-11-14 KST · `v2-design` · 사용자 결정 **D1 = gateway를 개발 프로젝트 Supabase Edge Functions에**, **D2 = 개발 단계 로그인 = 이메일 인증번호(Supabase 기본 메일)** · main 미반영

## 0. 한눈에

| 항목 | 상태 |
|---|---|
| Preview 로그인·세션 모듈(Rust `online.rs`) | **완료(가짜 서버 시험)** — 실제 서버 왕복은 아래 두 막힌 항목 뒤 |
| Preview 계정 카드(화면) | **완료** — 이메일 → 인증번호 → 로그인 → 서버 확인 표시 → 다시 확인·로그아웃 |
| gateway Edge Function `wjb-gateway` | **배포됨(v2), 아직 동작 안 함** — 서버 열쇠 형식 문제(2절), 응답 503 `RUNTIME_KEY_*` |
| 로그인 메일 양식에 인증번호 넣기 | **미실행** — 지금 양식은 링크만 있음(3절) |
| 검증용 설치 파일 run 1(6-B) | 성공 — Windows·macOS 산출물(78문서 7절) |

## 1. 구조

```
Preview 화면(PreviewApp) ──IPC──▶ Rust online.rs ──HTTPS──▶ vsphftnmfzfoufasjttd.supabase.co
   이메일·계정 ID·확인 시각만        │ 갱신 토큰 = OS 보안 저장소            /auth/v1/otp·verify·token·logout (공개 키)
                                    │ 접근 토큰 = 메모리                    /functions/v1/wjb-gateway/v2/me (사용자 토큰)
                                    └ 기기 ID·계정(비밀 아님) = Preview 설정 폴더/development/<ref>/
```

- **웹 화면은 네트워크를 쓰지 않는다** — CSP 그대로(단위 시험이 고정). 요청은 Rust에서만, 개발 프로젝트 주소 한 곳의 `/auth/v1/`·`/functions/v1/wjb-gateway/` 경로만(`path_allowed`), 리디렉션 따라가지 않음, 응답 64KiB 제한.
- 앱에 넣는 키 = **공개 키(publishable)** 하나. 서버 전용 열쇠·관리 토큰은 앱에 없다(단위 시험이 소스에서 확인).
- 보안 저장소 열쇠 = `com.chs2147.workjourneyboard.connected.preview.auth.v1` / `development:<ref>:<계정>:<기기>`(73문서 계약). 보안 저장소를 못 쓰면(Linux 등) **로그인하지 않고** 방금 만든 서버 세션을 닫는다 — 파일 대체 저장 없음.
- 갱신: 접근 토큰이 1분 안에 끝나면 보안 저장소의 갱신 토큰으로 새로 받고, 돌려받은 새 갱신 토큰으로 바꿔 저장. 갱신 거절 = 이 기기 로그아웃, 네트워크·5xx = 로그인 유지.
- gateway `GET /v2/me`: 토큰 서명(ES256, 같은 프로젝트 JWKS) + 서버 RPC `wjb_v2_session_active`로 세션 확인 → 계정 ID. 다른 계정 ID로 답하면 거절. `ACCESS_REVOKED`면 이 기기 로그아웃.
- 로그아웃: 서버 세션 닫기(`scope=local`) → 이 계정·이 기기 토큰만 지움. 기기 ID·다른 계정은 그대로.
- `poc/v2-native` `Secret::with_str` 추가 — 갱신 요청 본문을 만들 때만 빌려 씀(복사본을 돌려주지 않음).
- Classic 빌드에는 이 모듈이 없다(`#[cfg(feature = "connected-preview")]`, 명령 목록 단위 시험).

## 2. 막힌 지점 ① — gateway 서버 열쇠

- Edge 런타임이 넣어 주는 `SUPABASE_SERVICE_ROLE_KEY`가 예전 JWT 형식이 아니다(배포 v2 응답 `RUNTIME_KEY_UNAVAILABLE`). 기존 gateway REST 어댑터는 **검증된 예전 JWT 형식만** 받는다(51문서, 새 형식 `sb_secret_` 전달은 미검증이라 거절).
- 시도 A: 이 세션 환경의 개발용 예전 형식 열쇠를 Edge Function 비밀 `WJB_GATEWAY_SERVICE_ROLE_JWT`로 넣기 → **권한 확인에서 거절**(서버 열쇠를 새 위치로 옮기는 동작). 실행되지 않았다.
- 시도 B: 런타임 열쇠 형식만 단계 코드로 알려 주도록 다시 배포 → **권한 확인에서 거절**. 실행되지 않았다.
- 지금 배포된 함수(v2)는 모든 요청에 503을 돌려준다(데이터 접근 없음).

## 3. 막힌 지점 ② — 인증번호 메일 양식

개발 프로젝트 인증 설정: 메일 인증번호 8자리, 메일 발송 한도 시간당 2통(기본 메일), 가입 허용. 그러나 로그인·가입 확인 메일 양식에 `{{ .Token }}`이 없어 **메일에 숫자가 오지 않는다**. 관리 API로 두 양식(한국어 제목·본문 + 인증번호)을 바꾸는 것은 아직 하지 않았다. Supabase 기본 메일은 조직 구성원 주소로만 보낸다.

## 4. 검증

| 시험 | 결과 |
|---|---|
| Rust Preview 빌드 | 36 통과(로그인 흐름 새 8: 입력 검사 요청 전 차단, 토큰은 보안 저장소에만·파일·화면에 없음, 재시작 후 갱신·회전 저장, 서버 세션 끊김 → 이 기기만 로그아웃·다른 계정 토큰 유지, 갱신 거절/네트워크/503 구분, 보안 저장소 없음 → 로그인 거부·서버 세션 닫기, 로그아웃, 다른 계정 응답 거절) |
| Rust Classic 빌드 | 28 통과(변화 없음) |
| Vitest | 63파일 569 통과(`appProfile` 9: 명령 목록·접속 범위·CSP) |
| E2E | `connected-preview` 4 + smoke 통과(브라우저 모드 가짜 계정, 외부 요청 0) |
| V2 회귀 · v2-native | 335 · 31 통과 |
| gateway 번들(Node에서 실제 개발 JWKS·예전 형식 열쇠로) | 토큰 없음 401·가짜 토큰 401·Origin 403·없는 경로 401 — 배포 전 확인 |
| 배포된 Edge Function | v1·v2 배포 201·ACTIVE, 응답 503(2절) — [배포 기록](evidence/preview-dev-gateway-deploy.json) |

## 5. 다음(사용자 결정 뒤)

1. gateway 서버 열쇠 — 아래 중 하나
   - (추천) 사용자가 대시보드 Edge Functions › Secrets에 `WJB_GATEWAY_SERVICE_ROLE_JWT` = 개발 프로젝트 예전 형식 service_role 열쇠를 직접 넣음 → 함수가 그 값만 읽도록 다시 배포
   - 또는 새 형식 열쇠 전달 방식을 실제로 검증해 REST 어댑터에 더함(검증 시험 추가 필요)
2. 메일 양식에 인증번호 넣기(관리 API로 개발 프로젝트만)
3. 실서버 왕복 검증: 가상 계정으로 인증 → `/v2/me` → 갱신 → 로그아웃 후 401 → 시험 계정 삭제·잔여 0
4. 검증용 설치 파일(로그인 포함)로 Windows·macOS 실기 — 보안 저장소 실제 동작
