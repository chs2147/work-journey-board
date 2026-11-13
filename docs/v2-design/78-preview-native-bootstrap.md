# 78. Connected Preview 실행 프로필·Tauri 명령 경계 (6-B)

2026-11-14 KST · `v2-design` · 기준 제품 앱 1.40.0 / 일지 구조 v20 · **main 미반영**

## 0. 한눈에

| 항목 | 결과 |
|---|---|
| 사용자 결정 | 구조 = **`src-tauri`에 기능 플래그**(2026-11-14 선택, 추천안). 별도 Preview 크레이트·기능 복제는 하지 않음 |
| Classic 빌드 | 기본 빌드 = 예전과 같은 앱 ID·설정 폴더(`WorkJourneyBoard`)·업데이트·플러그인 순서·명령 목록. 더한 것은 읽기 전용 `app_profile` 명령 1개 |
| Preview 빌드 | `--features connected-preview` + `tauri.preview.conf.json` — 별도 앱 ID·이름·설정 폴더, 업데이트 꺼짐, SQLite 플러그인·기존 일지 명령 없음, Preview 시작 화면만 |
| 시작 검사 | 빌드 프로필 ≠ 설정 앱 ID면 플러그인·창·설정 파일보다 먼저 멈춤 — Linux 실제 실행으로 확인(exit 101) |
| 시험 | Rust Classic 28 · Preview 28 · 단위 567 · E2E Chromium 356/357(실패 1은 기존 불안정, 4절) · V2 회귀 335 · `poc/v2-native` 31 |
| 남은 관문 | Windows·macOS 실기(동시 설치·실행, WebView2/WKWebView 저장 위치, 단일 인스턴스, 서명·Keychain·Credential Manager). 그 전에는 설치판을 만들거나 게시하지 않는다 |

73문서 "다음 단계"(Preview native bootstrap·명령 경계)와 67문서 5절 6-B(실행 profile/설정/IPC/업데이트 분리)의 **코드 부분**이다. 양 OS 동시 설치·실행 확인은 실기 항목으로 남는다.

## 1. 구조

| 파일 | 내용 |
|---|---|
| `src-tauri/src/profile.rs` | `AppProfile`(key·앱 ID·이름·설정 폴더·updates·localJournal). Classic 값은 상수, Preview 값은 공통 정본 `poc/v2-native/profiles.tsv`를 `wjb-native-isolation`으로 읽음(복사 없음). `check_identifier`·`require_updates`·`app_profile` 명령 |
| `src-tauri/Cargo.toml` | `[features] connected-preview = ["dep:wjb-native-isolation"]`, 선택 경로 의존성(외부 crate 없음). Classic 빌드에는 링크되지 않음(`Cargo.lock`에 경로 패키지 1줄만 추가) |
| `src-tauri/src/lib.rs` | `generate_context!()` 직후 `check_identifier` → 불일치면 panic. SQLite 플러그인은 Classic만(등록 순서 그대로: 단일 인스턴스 → 창 상태 → SQLite → …). 명령 목록을 프로필별로 나눔 |
| `src-tauri/src/files.rs` | 설정 폴더 = `profile::active().config_dir`(Classic = `WorkJourneyBoard` 그대로) |
| `src-tauri/src/update.rs` | `update_check`·`update_download`·`update_install`·`updates_dir` 첫 줄 `require_updates()` — Preview는 네트워크 전에 `UPDATES_DISABLED`(Preview는 애초에 명령도 등록하지 않음, 이중 차단) |
| `src-tauri/tauri.preview.conf.json` | 덮어쓰기: `identifier`·`productName`·`mainBinaryName`(`work-journey-board-connected-preview`)·창 제목·`app.security.capabilities = ["preview-main","splash"]`만. 창 배열은 merge patch로 통째로 바뀌므로 제목 외 값이 기본과 같은지 단위 시험이 본다 |
| `src-tauri/capabilities/preview-main.json` | Preview 메인 창 권한: `core:default`·`window-state:default`·창 제목·테마만. **Classic `default`의 부분 집합**이라 Classic(권한 목록 지정 없음 = 모든 파일)에 새 권한이 생기지 않음 |
| `src/platform/index.ts` | `loadAppProfile()`(실앱 = `app_profile`, 브라우저 모드 = `?profile=connected-preview`), `parseAppProfile`, `loadSplash()` |
| `src/platform/tauriSplash.ts` | 스플래시 넘기기만 따로 — Preview 화면은 일지·SQLite 모듈을 불러오지 않음 |
| `src/main.tsx` | 프로필을 먼저 묻고 Preview면 `PreviewApp`만(별도 창 주소 `?win=…`은 빈 화면) |
| `src/ui/preview/PreviewApp.tsx` | Preview 시작 화면 — 기존 시작 카드(`FirstRun.module.css` `wrap`·`card`·`facts`) 그대로. `appController.start`·첫 실행·새 판 확인을 부르지 않음 |

빌드 명령(로컬):

```sh
npx tauri build --config src-tauri/tauri.preview.conf.json --features connected-preview
```

검증용 설치 파일은 별도 워크플로 `.github/workflows/build-preview.yml`이 만든다(7절). 기존 `build-desktop.yml`·`ci.yml`은 바꾸지 않았다.

## 2. 명령·권한 경계

| | Local Classic | Connected Preview |
|---|---|---|
| 앱 ID / 이름 | `com.chs2147.workjourneyboard` / Work Journey Board | `com.chs2147.workjourneyboard.connected.preview` / Work Journey Board Connected Preview |
| 실행 파일 이름 | `work-journey-board`(기본, 그대로) | `work-journey-board-connected-preview` — 윈도우 설치 프로그램은 실행 중인 앱을 파일 이름으로 찾아 닫기를 묻기 때문에, 같으면 Preview 설치가 Classic을 닫으려 할 수 있다 |
| 설정 파일 | 로컬 데이터/`WorkJourneyBoard/config.json` | 로컬 데이터/`WorkJourneyBoardConnectedPreview/config.json` |
| WebView·창 상태·단일 인스턴스 | 앱 ID 기준(예전과 같음) | 앱 ID 기준으로 분리 — Linux에서 WebView 저장 폴더가 앱 ID별로 따로 생기는 것 확인, Windows·macOS는 실기 |
| SQLite 플러그인 | 있음 | **없음** |
| 명령 | 예전 25개 + `app_profile` | `splash_finish`·`config_read`·`config_write`·`open_url`·`app_profile` 5개 |
| 일지·백업·복원·내보내기·Cabinet | 그대로 | 명령 없음(호출하면 Tauri가 거절) |
| 업데이트 | 그대로(GitHub Releases) | 명령 없음 + 함수 첫 줄 거절, 업데이트 저장소 없음 |
| 화면 | 기존 앱 | Preview 시작 화면 |

화면 쪽 프로필 묻기가 실패하면 Classic 화면으로 시작한다. Classic 빌드는 `app_profile`을 늘 등록하고, Preview 빌드는 Rust에 일지 명령·SQLite 플러그인이 없어 Classic 화면으로 가도 일지를 열거나 쓸 수 없다(경계는 Rust 쪽이 정본).

## 3. Classic 무영향 확인

- `tests/unit/appProfile.test.ts`: Classic 명령 목록 = 예전 25개 + `app_profile`(순서까지), `tauri.conf.json` 앱 ID·이름·권한 목록 없음·업데이트 플러그인 없음, Preview 권한 ⊂ Classic 권한
- Rust `classic_build_keeps_existing_behavior`: 설정 폴더 `WorkJourneyBoard`, 업데이트 켜짐, Classic 빌드를 Preview 설정으로 켜면 거절
- Rust `classic_constants_match_shared_profiles_and_tauri_conf`: 공통 정본 = 상수 = `tauri.conf.json`
- V2 `isolation.test.mjs`·`native-profile.test.mjs`: Classic 설정 폴더를 `files.rs` 상수 대신 `profile.rs` 상수에서 읽도록 고침(값은 같음)
- Linux 실제 실행: Classic은 예전 첫 실행 화면 그대로([화면](evidence/preview-bootstrap-linux-classic.png))

## 4. 검증

| 시험 | 결과 |
|---|---|
| Rust `src-tauri` Classic(`cargo test --lib`) | 28 통과(기준선 26 + 새 2) |
| Rust `src-tauri` Preview(`--features connected-preview`) | 28 통과, 경고 없음 |
| Vitest 전체 | 63파일 567 통과(새 `appProfile.test.ts` 7) |
| E2E Chromium 전체 | 357개 중 356 통과. 실패 1 = `note-relation.spec.ts:169`(관계선 마우스 잇기, 191줄) — **원래 커밋에서도 같은 줄에서 실패**(단독 5회: 원래 4실패, 변경 후 3실패)해 이 환경의 기존 불안정 시험으로 판단, 이번 변경과 무관 |
| 새 E2E `connected-preview.spec.ts` | 3 통과 — Preview: 시작 화면만, sql.js wasm 요청 없음, 레일·일지 상태 없음, 외부 요청 없음 / `?win=` 빈 화면 / Classic 그대로 |
| V2 Node 회귀 | 335 통과 |
| `poc/v2-native` Rust | 31 통과, `check-os-bindings` 통과 |
| lint·typecheck·format | 통과 |
| Linux 실제 실행(Xvfb, 임시 홈) | Classic·Preview·불일치 3가지 디버그 빌드: Preview 화면 표시([화면](evidence/preview-bootstrap-linux-preview.png)), WebView 저장 폴더 앱 ID별 분리, Preview 빌드 + Classic 설정 = 시작 전 panic(exit 101, 폴더 생성 없음) |

Linux 실행은 WebKitGTK라 Windows(WebView2)·macOS(WKWebView)의 저장 위치·단일 인스턴스·서명 동작을 대신하지 않는다. WebKit E2E는 이 세션에서 돌리지 않았다(CI 몫).

## 5. 하지 않은 것

- 릴리스·태그·기존 업데이트 피드 게시, 판올림·릴리스 노트·Feature List(v2-design 내부 작업, 제품 판 없음)
- 로그인·온라인 공간 화면(A안), OS 자격증명 실제 사용, 캐시/Repository 포트, 서버 활성화 API — 다음 단계
- Classic 설정 자동 가져오기(계속 금지)
- 클라우드·운영 프로젝트 접속

## 6. 다음

1. Windows·macOS 실기: Classic과 Preview 동시 설치·실행, 설정·WebView·창 상태·단일 인스턴스 분리, Preview에서 일지·업데이트 명령 거절 확인(설치판은 Actions 산출물로만, 기존 릴리스 피드 게시 금지)
2. 73문서 순서: native 캐시/Repository 포트 → 서버 활성화 API → 로그인·세션 수명(OS vault 연결) → A안 제품 화면을 `PreviewApp` 자리에 연결

## 7. 검증용 설치 파일 워크플로 (2026-11-14 사용자 요청)

`.github/workflows/build-preview.yml` — `v2-design` 푸시(앱·Tauri·프로필 정본·이 워크플로가 바뀔 때)와 수동 실행.

| 단계 | 내용 |
|---|---|
| 권한 | `contents: read` — **릴리스·태그를 만들 수 없다**. 산출물(Actions artifact, 14일 보관)로만 올린다. Classic 업데이트 피드(GitHub Releases)에 Preview가 올라가지 않는다 |
| plan | 프로필 정본(`profiles.tsv`)과 `tauri.preview.conf.json`의 앱 ID·이름이 맞고 업데이트 저장소가 비었는지 확인. 이름표 = `<앱 판>-preview.<커밋 7자>` |
| windows | `tauri build --config src-tauri/tauri.preview.conf.json --features connected-preview` → NSIS(현재 사용자). Rust 시험 Classic·Preview 둘 다. 설치 파일 이름이 Preview인지 확인 → `WorkJourneyBoardConnectedPreview_<이름표>_setup.exe` + `SHA256SUMS-windows.txt` |
| macos | 같은 설정으로 유니버설 DMG. Rust 시험 둘 다. DMG 안 앱의 `CFBundleIdentifier`·`CFBundleName`이 Preview인지, 유니버설·애드혹 서명 확인 → `WorkJourneyBoardConnectedPreview_<이름표>_mac.dmg` + `SHA256SUMS-macos.txt` |

실기에서 볼 것(m1-check 형식으로 결과를 남긴다):

1. Classic이 켜진 상태에서 Preview 설치 — Classic을 닫으라고 하지 않는지, 설치 폴더·시작 메뉴/응용 프로그램 이름이 따로인지
2. 둘을 동시에 실행 — 각각 한 창씩, 두 번째 실행은 자기 창만 앞으로
3. 설정·WebView·창 상태 폴더가 앱 ID별로 따로인지(윈도우 `%LOCALAPPDATA%`, 맥 `~/Library/Application Support`·`~/Library/WebKit`)
4. Preview는 Preview 시작 화면만, 업데이트 확인 없음. Classic 일지·설정 파일이 바뀌지 않음(수정 시각)
5. Preview 제거 후 Classic 그대로
