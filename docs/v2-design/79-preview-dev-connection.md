# 79. B단계 — Preview 앱 ↔ 개발 DB 첫 연결

2026-11-14 KST · `v2-design` · 사용자 결정 **D1 = gateway를 개발 프로젝트 Supabase Edge Functions에**, **D2 = 개발 단계 로그인 = 이메일 인증번호(Supabase 기본 메일)** · main 미반영

## 0. 한눈에

| 항목 | 상태 |
|---|---|
| Preview 로그인·세션 모듈(Rust `online.rs`) | **완료 — 실서버 왕복 8검사 통과**(6절, 2026-11-14) |
| Preview 계정 카드(화면) | **완료** — 이메일 → 인증번호 → 로그인 → 서버 확인 표시 → 다시 확인·로그아웃 |
| gateway Edge Function `wjb-gateway` | **동작(v4)** — 사용자가 대시보드에 넣은 비밀 `WJB_GATEWAY_SERVICE_ROLE_JWT`만 읽음(2절) |
| 로그인 메일 양식에 인증번호 넣기 | **사용자 대시보드 작업 대기** — 관리 토큰에 인증 설정 쓰기 권한 없음(3절) |
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

## 2. gateway 서버 열쇠 (해결)

- Edge 런타임이 넣어 주는 `SUPABASE_SERVICE_ROLE_KEY`가 예전 JWT 형식이 아니다(배포 v2 응답 `RUNTIME_KEY_UNAVAILABLE`). 기존 gateway REST 어댑터는 **검증된 예전 JWT 형식만** 받는다(51문서, 새 형식 `sb_secret_` 전달은 미검증이라 거절).
- 시도 A: 이 세션 환경의 개발용 예전 형식 열쇠를 Edge Function 비밀 `WJB_GATEWAY_SERVICE_ROLE_JWT`로 넣기 → **권한 확인에서 거절**(서버 열쇠를 새 위치로 옮기는 동작). 실행되지 않았다.
- 시도 B: 런타임 열쇠 형식만 단계 코드로 알려 주도록 다시 배포 → **권한 확인에서 거절**. 실행되지 않았다.
- 해결(2026-11-14): 사용자가 대시보드 Edge Functions › Secrets에 `WJB_GATEWAY_SERVICE_ROLE_JWT`(개발 프로젝트 예전 형식 service_role)를 직접 넣었다. 함수는 그 값만 읽도록 고쳐 v4 배포 → 토큰 없음·가짜 토큰 401, Origin 403. 이 세션은 값을 다루지 않았다.
- **예전 API 키는 2027년 초 은퇴 예정**(대시보드 안내). 운영 준비(G단계) 전에 gateway REST 어댑터를 새 형식 `sb_secret_` 키로 옮겨 검증하고 이 비밀을 지운다.

## 3. 인증번호 메일 양식 (사용자 작업 대기)

개발 프로젝트 인증 설정: 메일 인증번호 8자리, 메일 발송 한도 시간당 2통(기본 메일), 가입 허용. 그러나 로그인·가입 확인 메일 양식에 `{{ .Token }}`이 없어 **메일에 숫자가 오지 않는다**. 관리 API로 두 양식(한국어 제목·본문 + 인증번호)을 바꾸는 것은 아직 하지 않았다. Supabase 기본 메일은 조직 구성원 주소로만 보낸다.

관리 API로 바꾸려 했으나 개발 관리 토큰에 `project_admin_write` 권한이 없어 403(설정 그대로). 사용자가 대시보드 Authentication › Emails에서 **Magic Link**와 **Confirm signup** 두 양식에 `{{ .Token }}`을 넣는다(제목·본문 예시는 세션 안내). 인증번호 로그인 자체는 6절에서 관리 API 인증번호로 이미 검증했다.

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

## 6. 실서버 왕복 결과 (2026-11-14)

`node poc/v2-gateway/edge/live-preview-auth.mjs --run-development-preview-auth` — 가상 시험 계정(`…@example.invalid`, 메일 발송 없음, 관리 API 인증번호) → **앱 Rust 코드 그대로**(`online.rs` live 시험, 보안 저장소만 메모리 가짜) → 계정 삭제.

| 검사 | 결과 |
|---|---|
| 인증번호 로그인 → 로그인 상태 | 통과 |
| gateway `/v2/me` 세션 확인(서명 + 세션 RPC) | 통과 |
| 갱신 토큰은 보안 저장소에만(파일에 없음) | 통과 |
| 접근 토큰 만료 → 실제 갱신 → 다시 확인 | 통과 |
| 갱신 토큰 회전 저장 | 통과 |
| 로그아웃 → 저장소 비움 | 통과 |
| 로그아웃 뒤 같은 접근 토큰으로 gateway = `ACCESS_REVOKED` | 통과 |
| 틀린 인증번호 거절 | 통과 |
| 정리 | 계정 삭제 200·조회 404, 읽기 조회로 시험 계정·고아 세션·차단 세션·gateway 기기/공간·이관 작업 모두 0 |

[증거](evidence/preview-dev-auth-live.json) · [배포 기록](evidence/preview-dev-gateway-deploy.json)

## 5. 다음

1. ~~gateway 서버 열쇠~~ 해결(2절) · ~~실서버 왕복~~ 통과(6절)
2. 메일 양식에 인증번호(사용자 대시보드, 3절) → 본인 이메일로 실제 메일 로그인
3. 검증용 설치 파일(로그인 포함)로 Windows·macOS 실기 — 보안 저장소(Credential Manager·Keychain) 실제 동작, 앱 재시작 후 로그인 유지
4. 운영 전: gateway를 새 형식 키로(2절)
