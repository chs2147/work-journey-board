# 73. Connected Preview 네이티브 프로필·자격증명 격리

2026-11-11 세션 · v2-design · 앱1.24.3/기존 DB19 유지

## 사용자 결정과 이번 결과

기존 작업8169a44는 원격과 일치하여 시작 시 재푸시만 확인했다. 사용자가 **“검증판은 별도 Connected Preview로 진행”**을 선택했다. 이제 별도 Preview 설치 방향을 다시 묻지 않는다. 이 결정은 검증판의 공존/격리 방식을 뜻하며 정식 V2의 최종 이름·릴리스 저장소를 확정하지 않는다. 67/71/72문서의 당시 ‘별도 설치 미확정’ 표기는 이 후속 결정으로 갱신된다.

독립 Rust 라이브러리 `poc/v2-native`를 구현했다. crate 0.1.0은 내부 모듈 버전이며 제품 1.24.3과 다른 버전 축이다. 프로필/경로와 OS 자격증명 API를 native 코드로 구체화하고, 기존 Node 분기도 같은 프로필 정의를 읽도록 연결했다. **Classic 제품의 src/src-tauri/설정/Cargo/DB/업데이트 피드/배포/Cloud는 변경하지 않았다.** 실제 Preview 실행 파일·설치판·로그인 화면·Tauri IPC 등록은 아직 없다.

## 현행 코드 조사

| 경계 | 확인한 현행 코드 | 의미 |
|---|---|---|
| 앱 식별 | src-tauri/tauri.conf.json | com.chs2147.workjourneyboard |
| 설정 | src-tauri/src/files.rs CONFIG_DIR | 앱 ID와 별도로 WorkJourneyBoard에 고정 |
| 업데이트 파일 | src-tauri/src/update.rs updates_dir | app_local_data_dir()/updates |
| 업데이트 서버 | update.rs RELEASES_API/LATEST_PAGE/DOWNLOAD_PREFIX | 기존 저장소 주소에 고정 |
| 단일 인스턴스 | src-tauri/src/lib.rs | tauri-plugin-single-instance 등록 |
| 창 상태 | lib.rs | window-state 플러그인 등록 |

따라서 **기존 Tauri 설정의 identifier만 바꿔 Preview를 빌드하지 않는다.** files.rs·업데이트 명령·native bootstrap·WebView/창 상태/instance 경계를 실제로 연결해야 한다. 현재 라이브러리는 그 연결을 위한 타입/정책/저장소 구현이며 기존 앱을 다른 이름으로 실행하는 우회 경로가 아니다.

## 공통 프로필 정본

`poc/v2-native/profiles.tsv`를 Rust의 include_str와 Node isolation 모듈이 함께 읽는다. 두 구현에 앱 ID/이름/설정 폴더/릴리스 저장소를 따로 복사하지 않는다. Node에서 읽는 것은 이 체크인된 코드 리소스뿐이며 기존 사용자 config나 환경변수를 자동 탐색하지 않는다.

| 항목 | Local Classic 유지 | Connected Preview |
|---|---|---|
| 앱 ID | com.chs2147.workjourneyboard | com.chs2147.workjourneyboard.connected.preview |
| 표시 이름 | Work Journey Board | Work Journey Board Connected Preview |
| 설정 폴더 | WorkJourneyBoard | WorkJourneyBoardConnectedPreview |
| 업데이트 저장소 | chs2147/work-journey-board | 없음, 업데이트 비활성 |
| 파일 연결 | 기존 정책 유지 | 초기 미등록 |
| 세션 저장소 | 새로 초기화하지 않음 | Preview auth.v1 namespace |

Native `Profile`/`WorkspaceKind`/`CloudEnv`는 enum이며 UI 문자열/네트워크 끊김으로 유형을 바꾸지 않는다. 로컬 전용 workspace나 Classic 프로필은 secure vault factory 자체를 호출하기 전에 거절한다.

## 경로와 환경 분리

OS가 제공하는 신뢰된 Local Data 기본 경로를 `B`라 할 때 native layout의 계약은 다음과 같다. 실제 SDK가 돌려주는 경로·WebView/플러그인 저장 위치는 OS 실기로 확인해야 한다.

| 목적 | Preview 경로 계획 |
|---|---|
| 공통 UI 설정 | B/WorkJourneyBoardConnectedPreview/config.json |
| 개발 프로젝트 상태 | B/WorkJourneyBoardConnectedPreview/development/vsphftnmfzfoufasjttd/ |
| 운영 프로젝트 상태 | B/WorkJourneyBoardConnectedPreview/production/hutqsfftioxtredcjhsy/ |
| 공간 registry | 해당 프로젝트 상태/workspaces.sqlite |
| 온라인 캐시 루트 | 해당 프로젝트 상태/online-cache/ |
| 캐시 하위 공간 | registry가 관리하는 ownerUUID/workspaceUUID, 69/72문서의 범위 검증 유지 |
| native runtime/진단 | B/com.chs2147.workjourneyboard.connected.preview/diagnostics |
| instance namespace | com.chs2147.workjourneyboard.connected.preview:instance |

DEV와 PROD의 project ref가 뒤바뀌거나 누락되면 거절한다. 환경 선택이 없을 때 기존 공통 WJB_SUPABASE_PROJECT_REF나 반대 환경으로 fallback하지 않는다. Classic layout에는 cloud target/registry/cache가 필요하지 않다. Preview의 UI 설정 파일은 로그인 토큰 저장 장소가 아니며 실제 설정 serialization/저장은 후속 bootstrap에서 허용 필드만 연결한다.

기존 폴더 검사 함수는 명시적 보호 루트가 필수이며 원본과 동일/상위/하위 위치·canonical alias·파일을 디렉터리로 오인하는 경우를 거절한다. 폴더/DB/config를 생성·이관·탐색하지 않는다. 현재 테스트는 Linux의 canonical path/symlink다. Windows junction/short-name/case alias·macOS 정규화와 파일 교체 경쟁/원자적 생성은 native 실기·파일 핸들 기반 연결에서 계속 검증해야 한다.

## OS 자격증명 저장소

`SessionVault`가 사용할 수 있는 operation은 refresh token의 read/write/logout뿐이다. 키는 내부에서만 만든다.

- service: `com.chs2147.workjourneyboard.connected.preview.auth.v1`
- account: `environment:projectRef:ownerUUID:deviceUUID`
- Windows: Generic Credential(CredReadW/CredWriteW/CredDeleteW), 현재 사용자 저장소·Local Machine persistence
- macOS: Login Keychain Generic Password(Security framework), 일치하는 service/account 한 항목만 조회/갱신/삭제
- Linux/미지원 OS: UnsupportedPlatform. JSON/환경변수/localStorage/CLI 인자/파일 저장 fallback 없음

잠긴 Keychain·OS 접근 오류는 VaultUnavailable로 구분하며, 토큰이 없는 경우로 바꾸거나 파일에 저장하지 않는다. 로그아웃은 현재 tuple의 credential만 삭제하고 다른 계정·환경·기기의 token이나 워크스페이스/큐/원본을 삭제하지 않는다. 키/폴더 namespace 분리는 우발적 혼선을 막는 계약이며 같은 OS 사용자에서 실행되는 모든 프로그램에 대한 별도 보안 경계라고 주장하지 않는다. OS 권한·서명/ACL·사용자 프롬프트는 실기 확인 대상이다.

Secret은 Debug에서 REDACTED만 보이며 Clone/Display/serialization을 구현하지 않았다. UTF-8/크기(최대2048bytes)/제어문자를 검사하고 소유 Vec의 활성 바이트는 drop 때 volatile write로 지운다. 이는 프로세스·OS 내부의 모든 사본을 완전히 제거한다는 보장이 아니다. Windows/macOS가 반환한 메모리와 item reference는 해당 OS API로 반환한다. access token의 메모리 수명·refresh rotation·로그아웃 guard/대기열 UX는 기존 auth 계약과 다음 native 연결 단계에서 묶는다.

이 라이브러리에 service_role/Management token을 전달하지 않는다. 프런트엔드에 raw refresh token을 읽는 IPC 명령을 추가하지 않았다. 실제 native 인증 모듈이 vault를 사용하고 UI에는 비민감 세션 상태만 반환해야 한다.

## 구현/검증 범위

| 구성 | 이번 결과 |
|---|---|
| Rust 정책·scope·secret·vault 경계 | 구현, 외부 crate 의존성 없음 |
| Windows/macOS 저장소 함수 | 소스 구현, Linux에서 check-os-bindings 타입 검사 |
| 실제 Credential Manager/Keychain 읽기·쓰기 | 미실행. Fake vault로 범위/오류 동작 검사 |
| 실제 Tauri 앱 연결/동시 설치·실행 | 미구현/미검증 |
| Node↔Rust 프로필 정합 | 공통 TSV + Classic 실제 소스와 비교 검사 |
| 업데이트/파일 연결/배포 | 비활성 계약 유지, 제품 워크플로 미변경 |

Rust **31개** 테스트 통과. Classic/offline vault factory 호출0, DEV/PROD·계정·기기 격리, token 읽기·교체·선택 로그아웃, 잠긴 저장소, Secret Debug/입력, 원본 경로/파일 불변을 검사했다. OS vault는 Fake 구현이며 원본 폴더도 임시 가상 파일만 쓴다.

Node 신규 프로필 비교 **3개** + 기존 V2 회귀 **308개**, 총 **311개** 통과. 실제 Classic의 Tauri ID/config 상수/업데이트 URL과 공유 정의를 비교하고, Preview의 기존 릴리스 피드 게시 거절도 확인한다. lint/Prettier 통과. 과거 앱532·UI26·Cloud/PG·OS 실기를 새 실행으로 합산하지 않는다.

호스트에는 Rust가 없어 공식 rust:1.85-slim 컨테이너의 Rust1.85.1로 현재 UID에서 `--network none` 컴파일/테스트했다. check-os-bindings는 실제 Windows/macOS 타깃 컴파일·SDK 링크·ABI/OS 동작 검증을 대신하지 않는다. 해당 이미지에 Rustfmt/Clippy는 없어 그 검사를 통과했다고 표시하지 않는다(Prettier는 Rust를 검사하지 않음).

```sh
cargo test --offline --manifest-path poc/v2-native/Cargo.toml
cargo check --offline --manifest-path poc/v2-native/Cargo.toml --features check-os-bindings
node --test poc/v2-runtime/*.test.mjs poc/v2-assets/connected-copy.test.mjs poc/v2-migration/*.test.mjs poc/v2-sync/db18.test.mjs
```

[검증 집계·소스 hash](evidence/native-isolation-pass.json) · [Rust](evidence/native-isolation-rust.txt) · [Node 회귀](evidence/native-isolation-node.txt) · [lint/format](evidence/native-isolation-checks.txt)

## 다음 단계

**별도 Preview 결정은 완료**다. 다음은 Preview의 실제 native bootstrap/프로필 경로와 Tauri 명령 경계를 연결하는 작업이다. 기존 Classic 경로는 그대로 두고 Preview에서 Classic 초기화/기존 업데이트 명령으로 흘러가지 않도록 시작 단계에서 차단해야 한다. WebView/창 상태/단일 인스턴스 경로·OS 서명/Keychain 동작을 Windows/macOS에서 확인하기 전 설치판을 게시하지 않는다.

이후 native cache/repository 포트·실제 서버 활성화 API·로그인/세션 수명과 A안 제품 화면을 연결한다. cache-verified를 workspace-runtime으로 승격하지 않으며 기존 appController의 단일 전환 순서를 재사용한다. 다중 기기 변경 동기화/충돌 처리는7번, 전면 다국어는8번의 후속 범위다. 기존 로컬 모델은 영구 유지한다.
