# 94. 온라인 가입 — 초대한 사람만(스위치로 아무나 전환)

2026-11-16 · `v2-design` · 사용자 결정 **A안**(수파베이스 기본 스위치) · 개발 프로젝트 `vsphftnmfzfoufasjttd`(운영 프로젝트는 G단계에서 같은 방식)

## 1. 왜
무료 플랜 한도 안에서 운영하므로 온라인 동기화를 아무에게나 열지 않는다. 확인 결과(2026-11-16) 개발 서버는 **가입 허용 상태**였고 Preview 앱은 처음 보는 이메일이면 계정을 만들도록 요청한다(`create_user: true`) — Preview 설치 파일만 있으면 누구나 계정을 만들 수 있었다.

## 2. 방식(A안)

| 상태 | 수파베이스 스위치 "Allow new users to sign up" | 동작 |
|---|---|---|
| **초대 전용**(지금 목표) | 끔 | 관리 도구로 계정을 미리 만든 사람(초대)만 [인증번호 받기] → 로그인. 처음 보는 이메일은 서버가 거절 → 앱 안내 "초대받은 이메일만 가입할 수 있습니다." |
| 아무나 | 켬 | 지금처럼 누구나 이메일 인증으로 가입 |

- 서버(수파베이스 인증)가 막으므로 앱을 고쳐 우회할 수 없다. 앱은 그대로 `create_user: true`로 요청 — 스위치를 켜면 앱을 바꾸지 않고 바로 아무나 가입.
- 이미 있는 계정(사용자 본인)은 스위치와 상관없이 로그인된다.

## 3. 구현

| 위치 | 내용 |
|---|---|
| Rust `online.rs` | 인증번호 요청이 `signup_disabled`(가입 꺼짐)로 거절되면 `SIGNUP_INVITE_ONLY` 코드(cargo test) |
| 화면 | 오류 문구 "초대받은 이메일만 가입할 수 있습니다. 초대받은 주소인지 확인해 주세요." · 브라우저 모드 `?inviteOnly=1` 흉내(E2E) |
| 관리 도구 `poc/v2-gateway/edge/dev-signup-admin.mjs`(개발 프로젝트만, 명시 실행) | `--status-development`(가입 방식·계정 수) · `--invite-development <이메일>`(계정 미리 만들기, 메일 안 보냄) · `--list-development`(가린 이메일·만든 날짜) · `--signup-development invite\|open --confirm`(스위치) |

초대 예:
```bash
node poc/v2-gateway/edge/dev-signup-admin.mjs --invite-development 받을사람@example.com
```

## 4. 스위치 전환 — 지금은 대시보드에서
- 관리 토큰에 인증 설정 **쓰기** 권한이 없어(읽기만, 403) 도구의 스위치 명령은 `AUTH_CONFIG_WRITE_NOT_ALLOWED_USE_DASHBOARD`로 멈춘다.
- 대시보드: 개발 프로젝트 › **Authentication › Sign In / Providers** › **Allow new users to sign up** 끄기(초대 전용) / 켜기(아무나). 바꾼 뒤 `--status-development`로 확인.
- 토큰에 인증 설정 쓰기 권한을 주면 도구 명령 하나로 바꿀 수 있다(선택).

## 5. 확인
- Rust: 가입 꺼짐 응답 → `SIGNUP_INVITE_ONLY`, 다른 4xx·5xx는 기존 코드.
- E2E: 초대 전용 흉내에서 초대받지 않은 이메일 → 안내, 초대받은 이메일 → 로그인.
- 실서버(2026-11-16): 사용자가 대시보드 스위치를 끔 → 처음 보는 가상 주소로 인증번호 요청 → `422 signup_disabled`(앱 `SIGNUP_INVITE_ONLY`), 계정 생기지 않음 확인. 시험 계정 1개 초대(계정 2 = 본인 + 초대).
- 메일: Resend에 사용자 도메인 연결 완료(2026-11-16). 수파베이스 SMTP의 보내는 주소가 아직 `resend.dev`라 대시보드 Authentication › Emails › SMTP Settings › Sender email을 새 도메인 주소로 바꿔야 초대받은 사람에게 인증번호 메일이 간다(관리 토큰은 읽기만).
- 2026-11-16 스위치가 켜진 상태에서 한 확인 요청(가상 주소)은 메일 발송 실패(500)로 끝났고 계정이 생기지 않은 것을 확인했다(계정 수 1 = 사용자 본인).

## 6. 실기에서 발견·수정(2026-11-16) — 같은 PC에서 두 번째 계정에 첫 계정의 공간 목록이 보임
- **서버 자료는 섞이지 않았다**: 온라인 공간·동기화 공간은 모두 첫 계정 소유, 새 계정 것 없음(서버 조회로 확인). 서버가 다른 계정의 목록을 내준 것이 아니다.
- **원인 ①** Preview가 서버에 등록하는 기기 ID가 PC당 하나였다. 서버는 한 기기 ID를 한 계정에만 묶으므로(010 `wjb_v2_device_register`) 두 번째 계정의 기기 등록이 거절됐다 — 그런데 gateway가 그 거절을 일반 오류(`AUTH_UNAVAILABLE`)로 바꿔 앱은 이유를 몰랐다.
- **원인 ②** 화면이 목록 요청에 실패해도 이전(첫 계정) 목록을 지우지 않았다.
- **수정**
  - 서버 등록용 기기 ID를 **계정마다 따로**(`gateway-devices.json`). 처음 쓰는 계정은 예전 PC 기기 ID를 이어받고, 다른 계정이 이미 쓰면 새 ID. 보안 저장소 범위는 예전 PC 기기 ID 그대로(저장된 로그인 유지).
  - gateway(v12)가 기기 등록 거절 이유(`DEVICE_ACCESS_DENIED`·`DEVICE_REVOKED`·`DEVICE_LIMIT`)를 그대로 전달 → 앱은 `DEVICE_ACCESS_DENIED`면 그 계정용 새 ID로 한 번 더 등록.
  - 화면: 계정이 바뀌면 카드(목록·복제)를 새로 만들고, 목록 요청이 실패하면 목록을 비운다.
- 시험: Rust 62(계정별 기기 ID·거절 시 새 ID), gateway 69(거절 이유 전달), E2E 12.
