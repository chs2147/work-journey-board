# 개선 v25 상세 설계

2026-11-22 · `improve-v25` · 기준 `v1.51.0 Open Beta` (`d670439`) · 최신 main에서 새 작업 브랜치(CLAUDE.md 6절)

| 항목 | 내용 | 상태 |
|---|---|---|
| S1 의존성 보안 | `exceljs` 안의 `uuid@8.3.2` 알림(GHSA-w5hq-g745-h8pq, 보통) 정리 | 구현 |
| S2 Dependabot 4건 | `minimatch`·`url` 올림, `libsqlite3-sys`·`rsa`는 판단 기록 | 구현·기록 |
| S3 GitHub 보안 탭 결과 | Dependabot 4건·Code scanning(CodeQL) 10건 항목별 조치·닫기 사유 | 구현·기록 |
| S4 노트 바로가기 | 메모보드(주간·업무 보드)에 붙인 업무노트를 제목만 보이는 바로가기로 — 시안 `docs/mockups/v25/` | 승인(추천안)·구현 |
| S5 업무노트 블록 메뉴 | 표 칸 `/`로 메뉴가 열림·바깥 클릭에 안 닫힘·[닫기] 잘림 | 구현 |

## S1. `exceljs`의 `uuid`

- 알림: `uuid < 11.1.1`의 `v3`·`v5`·`v6`에 버퍼를 넘길 때 범위 검사가 빠진 문제. npm이 내놓는 해결은 `exceljs`를 3.4.0으로 **낮추는** 것이라 받지 않는다.
- 실제 영향: `exceljs`는 `uuid`의 `v4`만 쓴다(조건부 서식 확장 ID). 취약한 함수는 쓰이지 않아 앱 사용자에게 실제 위험은 없었다.
- 조치: `package.json` `overrides`로 `exceljs`의 `uuid`를 `^11.1.1`(CommonJS `require` 지원 판)로 지정. `npm ls uuid` = `exceljs@4.4.0 → uuid@11.1.1`, `npm audit --omit=dev` = 0건.
- 묶음 범위: 앱(브라우저)은 `exceljs`의 미리 묶인 빌드(`dist/exceljs.min.js`)를 쓰므로 그 안의 사본은 바뀌지 않는다 — `v4`만 쓰여 영향 없음. 이 조치는 의존성 목록·Dependabot 알림과 Node 쪽 사용(시험)에 적용된다.
- 런타임 네트워크 호출: 없음(`uuid`는 난수로 ID만 만든다, CLAUDE.md 4-1).
- 검증: 단위 634 통과, `npm run build` 통과, E2E 엑셀 내보내기·가져오기·CSP 아래 엑셀 14 통과.

## S2. Dependabot 알림 4건 (2026-11-23, 로컬 `npm audit`·`cargo audit`로 재현)

| 알림 | 경로 | 앱에 들어감 | 조치 |
|---|---|---|---|
| `uuid` < 11.1.1 (GHSA-w5hq-g745-h8pq, 보통) | `exceljs` | 미리 묶인 사본(영향 없음) | S1 — `overrides` 11.1.1 |
| `minimatch` 7~11.0.0 (GHSA-g3hv-75wg-m249, 보통 — 패턴 증폭 서비스 거부) | ESLint·typescript-eslint(개발 도구) | 아니오 | `eslint` ^10.15.0·`typescript-eslint` ^8.73.0(소판올림, `minimatch` 11.0.9) — lint 그대로 |
| `url` ≤ 2.5.8 (RUSTSEC-2026-0592 — 중첩 `blob:` 주소 `origin()` 스택 넘침) | Tauri 등 Rust 하위 | 예 | `Cargo.lock` `url` 2.5.9 |
| `libsqlite3-sys` 0.30.1 (RUSTSEC-2026-0459, SQLite < 3.54 — 쪽 크기가 다른 `-wal` 파일과 함께 열면 초기화 안 된 메모리) | `tauri-plugin-sql` → `sqlx` 0.8 | 예 | **지금은 올릴 수 없음**(고친 판 0.39는 `sqlx` 0.9 필요, `tauri-plugin-sql`이 아직 0.8). 영향 낮음: 로컬에서 조작된 일지·`-wal` 짝 파일을 열어야 하고, 앱은 `journal_mode=DELETE`라 `-wal`을 만들지 않음. `tauri-plugin-sql` 새 판이 나오면 올림 |
| (참고) `rsa` 0.9 (RUSTSEC-2023-0071) | `sqlx-mysql`(잠금 파일에만) | 아니오 — 컴파일되지 않음(`cargo tree -i rsa` 비어 있음) | Dependabot에 뜨면 "쓰지 않음"으로 닫기 |

- 검증: `npm audit`(개발 도구 포함) 0건, `cargo audit`은 위 두 건(`libsqlite3-sys`·`rsa`)만 남음. Rust 시험 72, 단위 634, 타입 검사 통과.
- `cargo audit` 경고(관리 중단·불안정·철회된 판 9건 — `chrono`·`glib`·`zbus` 계열 등)는 Tauri·GTK 하위 의존성이라 Tauri 판올림 때 함께 본다.

## S3. GitHub 보안 탭 결과 (2026-11-23 사용자 전달)

### Dependabot

| # | 알림 | 조치 |
|---|---|---|
| 2 | `uuid`(npm) | S1에서 고침 — main 반영 뒤 자동으로 닫힘 |
| 3 | `minimatch`(npm, 개발 도구) | S2에서 고침 — main 반영 뒤 자동으로 닫힘 |
| 4 | `glib` 0.18 `VariantStrIter` 불안정(Rust, `src-tauri`) | **닫기 — 쓰지 않음**: `glib`·`gtk`는 리눅스 화면 묶음(WebKitGTK)에서만 컴파일되고 배포하는 Windows·macOS 판에는 들어가지 않는다. 고친 `glib` 0.20은 Tauri(wry)가 아직 쓰지 않아 올릴 수 없음 |
| 1 | 같은 `glib`(`m0/src-tauri` — I-M0 설치 검증용 옛 껍데기) | **닫기 — 쓰지 않음**(위와 같음). `m0/`는 수동 워크플로 `m0-windows-build.yml`만 쓰는 기록용이라 정리 대상 후보 |

### Code scanning (CodeQL)

| # | 규칙 | 위치 | 판단 | 조치 |
|---|---|---|---|---|
| 1·2·3 | 워크플로 권한 미지정 | `ci.yml` 17·55·68 | 맞음 | **고침(main `d670439`)** — `permissions: contents: read`. 다음 분석에서 닫힘 |
| 5·7·8 | 나쁜 HTML 걸러내기 정규식·여러 글자 정리 불완전 | `cabiMarkdown.ts` 82 | 실제 위험 낮음 — 결과가 노트의 **글자 노드**(HTML로 그리지 않음) | **고침** — `htmlToPlainText`: 태그 지우기를 더 바뀌지 않을 때까지 반복(`<scr<script>ipt>` 같은 경우), `</script >`도 지움, 남은 꺾쇠 삭제 |
| 9 | 여러 글자 정리 불완전 | `cabinet.ts` 130(끌어 놓은 링크 제목) | 실제 위험 낮음 — 제목은 React 글자로 그려짐 | **고침** — 태그 지우기 반복 후 엔티티 풀기(엔티티로 쓴 `&lt;`는 글자로 남음) |
| 6 | 문자열 이스케이프 불완전 | `cabiMarkdown.ts` 178(노트 → Markdown 코드 조각) | 맞음(내보낸 Markdown이 깨질 수 있음, 보안 영향은 없음) | **고침** — `codeSpan`: 역슬래시 대신 글 안의 가장 긴 `` ` `` 묶음보다 긴 울타리(CommonMark 방식) |
| 4 | 클라이언트 XSS | `docs/v2-design/mockups/step6/index.html` 1715 | 거의 오탐 — 시안 파일, 주소의 장면 값은 이미 허용 목록 확인, 배포 사이트(`site/`)에 없음 | **보강** — `show()` 첫 줄에서도 허용 목록 확인 |
| 10 | 잘못된 포인터 접근 | `poc/v2-native/src/system_vault.rs` 45(윈도우 자격 증명 읽기) | **오탐** — `CredReadW` 성공·null 확인 뒤에만 읽고, 길이 상한·blob null 확인 후 복사, `CredFree`로 해제(윈도우 API 사용법 그대로) | **닫기 — 오탐(False positive)**. 보안 저장소 코드라 윈도우 실기 없이 고치지 않음 |

- 시험: `tests/unit/securityScan.test.ts`(겹친 태그·스크립트·꺾쇠, 코드 울타리, 링크 제목) 추가 — 단위 637 통과, lint·타입·Cabinet/Markdown E2E 12 통과.

## S4. 메모보드에 붙인 업무노트 → 노트 바로가기 (2026-11-23 요청·추천안 승인·구현)

- 요청: 주간 메모보드·Cabi.NET 업무 메모보드 공통 — 업무노트를 보드에 붙이면 지금은 노트 내용(본문 발췌·첫 그림)이 보인다. **제목만 보이고 내용은 보이지 않는 노트 바로가기 링크 객체**로 바꾼다.
- 지금 구조: 두 보드 모두 `NoteCanvas` → `ResourceCard`(`TextBox.resource` = `CabiReference`). 카드가 `resolveCabiReference`의 `title`·`text`·`image`를 그대로 그린다. 저장되는 것은 참조(`{ kind: "note", id }`)와 제목 한 문단뿐이라 **바뀌는 것은 그리는 방식뿐**(저장 형식·구조 v20 그대로). 보드 그림(PNG)·Markdown 내보내기는 지금도 카드 제목 문단만 담는다.
- 시안: `docs/mockups/v25/index.html` — A 링크 카드형(추천, 메모보드 링크 카드와 같은 생김새: 노트 아이콘 칸 + 제목 + "업무노트 · 업무 이름" + ↗, 선택 시 [항목 연결]·[지우기]) · B 한 줄 칩 · C 지금 카드에서 본문만 뺌.
- 결정(2026-11-23 사용자 승인 — 추천안): D1 A안 · D2 업무노트 카드만(주간 메모 원본 카드는 지금처럼 글 미리보기) · D3 작은 글씨 줄 = 업무노트 · 업무 이름 · D4 이미 붙여 둔 카드도 바로가기 모양(저장 형식 바뀌지 않음).
- 구현:
  - `ResourceCard`가 `kind: "note"`면 `NoteShortcut`(노트 아이콘 칸 · 제목 · "업무노트 · 업무 이름" · ↗ [노트 열기]), 그 밖(주간 메모)은 예전 카드(`SourceCard`). 더블클릭·Enter·↗ = 노트 창 열기. 선택하면 카드 왼쪽 위에 [항목 연결]·[카드만 삭제](오른쪽 위 복제 손잡이와 겹치지 않게). 원본이 지워졌으면 흐린 아이콘 + 제목 취소선 + "원본 없음", ↗ 없음.
  - 높이는 내용에 맞추고 너비만 조절 — `useBoxFrame(…, widthOnly)`: 저장된 `frameH`를 그리지 않고 좌우 손잡이만. 예전에 높이를 늘려 둔 카드도 바로가기 높이로 보인다(값은 그대로 남음).
  - 메인 창 `reference` 응답에서 노트 본문(`text`)을 더 보내지 않고 업무 이름(`owner`)만 더함 — 별도 창으로 노트 내용이 건너가지 않는다.
- 시험: `tests/e2e/cabi-net.spec.ts` "보드에 붙인 업무노트는 제목만 보이는 바로가기…"(본문 없음·예전 높이 무시·원본 없음·선택 도구·↗로 노트 창·카드만 삭제).
- 가이드: 장면11 원본 연결 카드 문단에 노트 바로가기 한 문장(스크린샷의 카드는 주간 메모 원본 카드라 그림은 그대로).

## S5. 업무노트 이끌이·"/" 블록 메뉴 (2026-11-23 요청·구현)

- 증상: 업무노트 표 칸에서 글을 고치는 중에 블록 메뉴가 뜻하지 않게 열려 표를 가리고, 메뉴 밖을 눌러도 닫히지 않으며, 메뉴 맨 아래 [닫기]가 잘려 누를 수 없었다.
- 원인: ① `/` 키를 누르면 자리와 상관없이 블록 메뉴를 열었다(표 칸의 `A/B` 같은 글자에도) ② 이끌이·`/` 메뉴에 바깥 클릭 닫기가 없었다(`Esc`만) ③ 메뉴 내용(약 495px)이 최대 높이 460px보다 길어 [닫기]가 스크롤 아래에 있었고, 위치도 창 높이 − 470px 기준이라 작은 창에서 잘렸다.
- 수정:
  - `/` 메뉴는 **빈 문단 맨 앞**에서만 연다 — 표 칸·코드 블록·문장 중간의 `/`는 글자 그대로(`cabiBlockMoves.ts` `slashAllowed`).
  - 이끌이·`/`로 연 메뉴는 **메뉴 밖을 누르면 닫힌다**(창 `pointerdown` 잡기 — 메뉴·이끌이 자신 제외). `/` 뒤에 글자를 이어 쓰거나 `/`를 지우거나 커서가 옮겨 가도 닫힌다.
  - 메뉴는 창 안에 다 들어오게 놓는다(아래가 모자라면 블록 위로), 최대 높이 520px, [닫기]는 스크롤돼도 늘 맨 아래(`position: sticky`).
- 시험: `tests/e2e/cabi-table-editing.spec.ts` "표 칸의 "/"는 글자 그대로…" 추가, 기존 "블록 메뉴 내부 스크롤" 시험은 창 높이 420으로(메뉴가 실제로 스크롤되게).
- 가이드: 장면11 블록 이끌이 문단에 "메뉴 밖을 누르면 닫힘·빈 줄 맨 앞 `/`" 한 줄.
