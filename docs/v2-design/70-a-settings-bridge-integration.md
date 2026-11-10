# 70. A안 설정 화면·저장소 연결 경계 검증

2026-11-10 UTC · v2-design · 제품 1.24.1 / 로컬 DB19 유지

## 이번 단계의 결과

A안(기존 설정 확장)을 기준으로 **브라우저 화면 → 화면 controller → 명령 bridge → SQLite registry → 읽기 전용 가상 DB19** 연결을 구현했다. 69문서의 목록·유형·실행 분기를 실제 확인 화면에서 호출한다. 계정/원본 경로/드라이버를 화면이 직접 지정하지 않는다.

이는 **독립 PoC의 연결 검증**이다. 기존 앱의 설정 화면에 배포한 기능이나 Tauri/Rust 구현이 아니다. 제품 `src`/`src-tauri`, 기존 config, DB migration, 버전, CSP, 환경변수, DEV/PROD Cloud, KeepAlive, 업데이트 피드를 변경하지 않았다. 실제 인증·쓰기·온라인 공간 생성은 수행하지 않는다. A안 재선택은 필요하지 않으며 별도 앱/설치 식별 정책은 여전히 별도 미확정 항목이다.

[확인 화면](mockups/step6-settings/a-settings.png) · [저장 실패](mockups/step6-settings/a-save-failure.png) · [온라인 활성화 차단](mockups/step6-settings/a-online-gated.png) · [다크](mockups/step6-settings/a-settings-dark.png) · [좁은 창](mockups/step6-settings/a-settings-narrow.png)

## 연결 구성

| 구성 | 파일/역할 | 구현 범위 |
|---|---|---|
| A안 화면 | `mockups/step6-settings/` | 기존 설정 내 공간 목록, 현재 공간/행 유형 배지, 오류 안내, 테마/반응형 |
| 화면 controller | `poc/v2-runtime/workspace-settings-controller.mjs` | 명령 요청, 늦은 응답 무시, 고정 안내 문구, 공개 필드만 상태에 복사 |
| 명령 bridge | `poc/v2-runtime/workspace-settings-bridge.mjs` | 요청 검증, 전환 직렬화·세대 검사, 계정 소유 확인, lifecycle 경계·handle 정리 |
| registry/router | 69문서의 독립 모듈 | 별도 목록 파일, 고정 유형, 계정별 캐시 경로, 원본 보호, 활성화 gate |
| 확인 서버 | `poc/v2-runtime/settings-review-server.mjs` | 임시 가상 공간 두 개/온라인 참조 한 개, DB19 읽기 전용 핸들, loopback 전용 중계 |

확인 화면의 온라인 상태 선택/저장 실패 조건은 **가상 데이터 시험용**이며 제품 옵션이 아니다. ‘온라인 연결’, 세 가지 생성/받기 동선은 A안의 배치만 나타내고 버튼을 비활성으로 둔다. 실제 서버 생성·로그인·이관 서비스가 연결되기 전 성공처럼 표시하지 않는다. ‘이 PC에 저장됨’ 또한 이 읽기 전용 가상 화면의 fixture 상태이며 실제 편집/쓰기 검증으로 간주하지 않는다.

## 네이티브로 옮길 명령 계약

화면 port는 `request(command, payload)`를 제공한다. 아래는 reference 계약이며 현재 Tauri IPC 명령으로 등록되지 않았다.

| 명령 | 화면 입력 | 결과/제약 |
|---|---|---|
| list | `{}` | 이 PC registry의 공개 목록·현재 참조 ID·phase |
| select | `{entryId}` | 등록 항목만 선택. owner/path/receipt/token 전달 금지 |
| deactivate | `{}` | 저장·노트 마무리·백업·분리·닫기. 원본/목록을 삭제하지 않음 |
| accountChanged | `{}` | native 인증 이벤트 전달용. 계정 값은 native가 다시 읽음. 현재 오프라인 세션은 유지 |

응답은 `{ok, state, code?}`이며 `state.entries`의 공개 필드는 `entryId/name/kind`뿐이다. 원본 경로, 캐시 경로, owner, metadata, credential, SQL handle을 UI로 반환하지 않는다. `code`는 고정 allowlist만 사용하며 내부 예외의 경로/키/서버 본문을 표시하지 않는다. 목록은 로컬 registry 참조 목록이지 서버의 모든 계정 공간을 검색하는 API가 아니다.

계정 context는 native가 소유한 `ownerId/revision`의 **값 사본**이다. revision은 로그인/로그아웃/계정 교체에 따라 증가하는 로컬 세대 번호이며 token이 아니다. 서버 검증을 기다리는 동안 세대나 계정이 바뀌면 결과를 버린다. 오프라인 선택·오프라인 세션의 계정 변경 이벤트에서는 이 context 제공자조차 호출하지 않는다. 기존 로컬판에 로그인/클라우드 초기화를 강제하지 않는다.

## 전환 무결성

기존 `CLAUDE.md` 4-7과 `src/ui/common/appController.ts`의 단일 전환 경계를 분석했다. reference bridge는 다음 순서를 검사한다.

1. 요청 참조/유형/소유 계정을 확인한다.
2. 현재 handle의 `flushPending` → `finishNote` → `backupBeforeClose`를 완료한다.
3. 요청이 최신인지 다시 확인한다.
4. `detachAll` → 이전 handle 닫기를 수행한다.
5. 69문서의 router로 신규 저장소를 검증/연다. 온라인은 제품용 활성화 증표가 필요하다.
6. 최종 세대 확인 후 동기식 `attach`를 수행하고 현재 참조를 공개한다.

실제 제품 연결 때는 **기존 appController의 경로를 재사용/추출**한다. 이 Node reference를 제품 안에 두 번째 전환 경로로 복사하지 않는다. `flushPending`에는 Cabi.NET 외부 창 flush와 예약 저장까지 포함해야 한다. detach에는 모든 store·구독·예약 타이머가 포함되어야 하며 백업 정책도 기존 로컬판 의미를 유지한다.

응답 유실/transport 오류는 실제 활성 handle을 확인할 수 없으므로 화면의 activeId를 지우고 unknown 상태로 잠근 뒤 목록 재조회로 정합한다. 이전 이름을 유지해 다른 저장소를 원본처럼 표시하지 않는다.

저장/노트 마무리/백업 실패는 이전 공간을 활성 상태로 보존하고 새 공간을 열지 않는다. detach/close 또는 화면 attach가 실패하면 어느 store가 붙어 있는지 불확실하므로 `blocked`로 잠그고 공개 activeId를 지운다. 늦게 도착한 신규 handle도 닫으며 그 닫기마저 실패하면 이후 열기를 차단한다. 온라인 서버/활성화 오류에서 오프라인 원본을 대신 열지 않는다. 저장 실패와 달리 이전 공간을 정상적으로 닫은 후 신규 공간이 실패했다면 선택 전 화면으로 남는다.

온라인 세션에서 계정이 바뀌면 native가 `accountChanged`를 호출하고 즉시 편집/화면을 잠가야 한다. reference의 정리 중 저장이 실패해도 온라인 내용을 계속 공개하지 않고 blocked로 유지한다. controller의 dispose는 **설정 화면 구독 정리**이며 현재 앱 워크스페이스를 닫는 명령이 아니다. 앱 종료/계정 전환 책임자는 별도 deactivate/accountChanged 완료를 관리한다.

현재 `attach`는 동기 callback 계약이다. 제품 구현에서 비동기 화면 연결이 필요하면 중간 attach의 rollback·epoch 확인을 별도로 설계/검증해야 하며 현재 모형을 그대로 비동기로 바꾸지 않는다.

## 확인 서버와 재현

```sh
node poc/v2-runtime/settings-review-server.mjs
# 출력된 http://127.0.0.1:14621 을 로컬 브라우저에서 연다.
# Ctrl+C로 종료하면 생성한 가상 DB 해시를 확인하고 임시 fixture만 정리한다.

node --test poc/v2-runtime/*.test.mjs poc/v2-assets/connected-copy.test.mjs poc/v2-migration/*.test.mjs poc/v2-sync/db18.test.mjs
PW_CHROMIUM_PATH=/usr/bin/chromium node docs/v2-design/mockups/step6-settings/verify.mjs
```

시스템 Chromium 경로가 다르면 `PW_CHROMIUM_PATH`를 해당 실행 파일로 지정하거나 Playwright 설치 브라우저 사용 시 생략한다. 확인용 HTML을 정적 서버로만 열면 API가 없으므로 위 실행기를 사용한다.

서버는 127.0.0.1에만 바인딩하고 Host/Origin/JSON을 제한한다. 원본 repo 전체를 정적 제공하지 않고 지정 HTML/CSS/JS만 제공하며 임의 파일·경로·명령·credential 필드는 거절한다. 이는 배포용 HTTP backend나 실제 native 보안 경계 검증을 대신하지 않는다. 프로세스 종료 시 **이 실행기가 만든 임시 fixture만** 정리하며 사용자 워크스페이스를 탐색하지 않는다.

## 검증 결과

이번 설정 연결 테스트 **29개**와 기존 회귀 **206개**, 총 **235개 통과 / 실패 0**. 실제 Linux 임시 SQLite 파일을 사용해 원본 해시 보존, 호출 순서, 저장/백업/닫기/attach 실패, 세대 경쟁, 계정 교체·가변 context, 늦은 handle 정리, 공개 필드 제한, 화면 dispose를 검사한다.

브라우저는 **3개 테마 × 3개 폭(1440/900/390px), 9개 배치**를 확인했다. 가상 로컬 두 공간을 3회 왕복하고, 저장 실패 시 기존 공간 유지, PoC 온라인 열기 차단, 온라인 유형의 연결 상태 독립, 잘못된 Origin/명령 필드/파일 접근 거절을 확인한다. JS 오류와 외부 요청은 0이며 종료 시 가상 원본 DB 해시는 일치한다.

[회귀 실행 로그](evidence/workspace-settings-regression.txt) · [집계/소스 hash](evidence/workspace-settings-pass.json) · [브라우저 결과](evidence/workspace-settings-ui-pass.json)

Windows/macOS의 설치·파일 잠금/junction/Keychain, 실제 Tauri IPC·CSP, 제품 편집/자동 저장·백업은 이번 시험 범위가 아니다. PG/실제 DEV Auth/Storage 시험을 재실행하거나 통과 수에 합산하지 않았다.

## 다음 작업과 남은 관문

다음 우선 작업은 **제품용 온라인 캐시 형식과 활성화 검증 어댑터**다. 기존 DB19와 별도 header/schema family/manifest를 정의하고, 현재 PoC 사본을 제품 캐시로 오인하지 않도록 한다. 온라인 DB에는 이미지 binary/base64를 넣지 않고 Blob 참조만 저장하며, 원본 DB19는 이 형식으로 전환하지 않는다.

이어서 native profile/config/설치/업데이트 격리 → OS 보안 저장소·OTP 수명 → 기존 appController 경계 재사용 → A안 제품 화면 연결을 진행한다. 별도 앱/설치 식별 정책은 실제 설치 설정을 반영하기 전 확정해야 한다. 준비/이관·생성·받기 서비스와 제품용 완료 증표가 연결되어야 이번 비활성 동선을 활성화할 수 있다. 7번 기기 간 동기화와 8번 전면 다국어는 별도 후속 단계다.
