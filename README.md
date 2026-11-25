<div align="center">

<p align="center"><img src="docs/brand/icon.svg" alt="" width="88" height="88"></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/wordmark-dark.svg">
    <img src="docs/brand/wordmark-light.svg" alt="Work Journey Board" height="51">
  </picture>
</p>

**오늘 한 일을, 한 줄씩.** 주간 보고부터 업무별 작업 공간, 기록을 잇는 Universe까지.

온라인 워크스페이스를 열면 Windows와 macOS에서 같은 업무 기록을 이어서 쓸 수 있습니다.

[최신 판 내려받기](https://github.com/chs2147/work-journey-board/releases/latest) · [소개 사이트](https://chs2147.github.io/work-journey-board/) · [온라인 워크스페이스 이용 가이드](https://chs2147.github.io/work-journey-board/guide/#s16) · [Version History](#version-history)

</div>

![Work Journey Board — 기록은 가볍게, 흐름은 선명하게](site/og-image.png)

![주간 보드와 이번 주 메모 보드 — 시그니처 테마(가상 기록)](docs/screenshots/board-signature.png)

<p align="center"><sub>주간 보드 · 이번 주 메모(업무 연결 메모·이미지·링크 카드·관계선) · 시그니처 테마 · 1.35 화면 · 화면 속 기록은 모두 가상 예시</sub></p>

## 핵심 기능
- **온라인 워크스페이스로 여러 기기에서** — 운영자가 등록한 이메일로 로그인해 빈 온라인 공간을 만들거나 이 PC 일지를 복제할 수 있습니다. 한 목록에서 이 PC와 온라인 공간을 오가고, 연결이 끊겼을 때도 이 기기에 작업을 저장한 뒤 다시 연결되면 동기화합니다. 1.51.0 Open Beta에서는 새 공간의 아이콘·색, 동기화 안내, Cabinet 폴더 열기와 항목별 사용량 표시를 개선했습니다. [기능 소개](https://chs2147.github.io/work-journey-board/#online-workspace)
- **매일 2분, 키보드만으로** — 주간·데일리 뷰에서 개조식 기록, 업무·태그 간편 추가, 마감일 컬러칩·중요 표시·완료/완료 취소·매주 반복. 날짜 지정 복제와 이전 기록 가져오기에서도 메모·자료 연결을 함께 유지
- **쓰기만 하면 주간 보고** — 업무별·요일별 자동 집계, 수정본, 사내 AI 도구용 다듬기 지시문, 여러 주 엑셀 2시트 · 메모 보드 그림 내보내기
- **칸반 보드로 상태 한눈에** (NEW) — 주간 보드에 적은 업무 항목이 그대로 TODO / 사용자 섹션 / DONE 카드가 됩니다. 카드를 끌어 상태 변경·DONE이면 세부까지 함께 완료(완료 축하 모션), 완료는 주간 보드·중요 업무 목록에 바로 반영. TODO·DONE까지 섹션 머리 끌기로 순서·섹션마다 색 아이콘, 균등/자유 배치, 업무 전체·하나·여러 개와 기간 아이콘으로 거르기, 업무 띠·시작 시간·마감일을 함께 정하는 카드 추가, 상태 이력·일괄 완료, 카드 ⋯로 매주 반복 (`Alt+6`, **1.40.0**)
- **지나온 일이 한눈에** — 년월→주차→요일별로 묶인 업무 타임라인(다른 날 완료한 항목은 실제 완료일), 유연한 열 너비의 활동 히트맵·habit tracker, 연간 보기
- **메모 보드로 맥락까지** — 업무항목에 연결한 글·이미지·링크 카드와 관계선, 다중 선택·그룹 이동·글자색·Markdown 파일 드롭, PNG·Markdown 내보내기
- **Universe — 기록이 살아 있는 연결 지도로** — 독립된 다크 우주에서 3D 회전·이동·확대/축소, 줌에 따라 이어지는 은하↔초점 탐색, 정적 2D·목록 보기. 접고 폭을 조절하는 필터·상세 패널, 시간 탐색·주를 넘는 직접 연결, 지식 카드·외부 AI에 붙여 넣을 근거 묶음 (`Alt+5`)
- **Cabi.NET — 업무별 자료·노트·메모보드** — 기존 Cabinet의 폴더·링크 관리를 확장한 업무 작업 공간. **1.20.0**부터 업무별 복수 블록 노트와 업무당 하나의 자유 보드를 별도 모달리스 창으로 제공. 누적 주간 메모 연결, 주간↔업무 보드 객체·이미지 복제, 목록·카드·보드 보기, Markdown 가져오기와 Markdown·한글 PDF 내보내기. 블록 이끌이로 순서를 옮기고, 선택한 글 가까이에서 서식·링크·글자색 편집 ([실제 화면](docs/mockups/cabinet-v2/implemented/README.md))
- **Live Widget — 업무의 현재 상태** — Cabi.NET 업무 보드에 시작일/마지막 기록일 기준 경과일, 업무 타임라인, 미완료 중요 업무를 배치. 타임라인은 기록 목록·가로 마일스톤·주차 요약으로 전환하고, 위젯에서 완료한 항목은 메인 업무에도 반영
- **워크스페이스로 회사·개인 따로** — 공간마다 독립 일지 파일, 레일의 공간 아이콘과 `Ctrl+Alt+1~9`로 전환. 업무·메모·자료·지식의 맥락을 공간별로 보관
- **찾고 맞추기** — 업무·메모·자료 통합 검색(`Ctrl+Shift+F`), Cabi.NET 노트·업무 보드 검색, 대한민국 공휴일·회사 휴일·기타 휴가, 업무·요일 열 폭 조절
- **빠른 이용 가이드** — 장면별 사용법을 [소개 사이트](https://chs2147.github.io/work-journey-board/guide/)에서 보거나 PDF로 내려받기. 최신 정식판은 Releases에서 확인

### 주요 기능 화면

![이 PC와 온라인 워크스페이스를 한 메뉴에서 전환하는 화면 — 가상 예시](site/guide/shots/16-online-switch.png)

| 칸반 보드 — 업무 항목을 상태로 한눈에 (**NEW 1.40**) | 칸반 자유 배치 — 섹션 위치·크기를 내 마음대로 |
|---|---|
| ![칸반 보드 — 섹션 아이콘이 붙은 TODO·사용자 섹션·DONE과 중요 업무 목록](docs/screenshots/kanban-signature.png) | ![칸반 자유 배치 — DONE 섹션을 아래로 옮긴 모습](site/guide/shots/15-kanban-free.png) |

| 주간 요약 — 기록을 보고서로 | 인사이트 — 업무 타임라인과 활동 |
|---|---|
| ![주간 요약 — 자동 집계](docs/screenshots/summary-signature.png) | ![인사이트 — 업무 타임라인](docs/screenshots/insights-signature.png) |

| Universe — 기록과 지식의 연결 지도 | Cabi.NET — 업무 노트와 자료 연결 |
|---|---|
| ![Universe — 독립 다크 우주의 기록 탐색](site/guide/shots/14-universe.png) | ![Cabi.NET — 업무별 블록 노트 편집](site/guide/shots/11-cabi-note.png) |

| Live Widget — 업무의 현재 상태와 가로 마일스톤 | 업무 메모보드 — 누적 주간 메모와 자료 연결 |
|---|---|
| ![Live Widget — 경과일·가로 마일스톤·중요 업무](site/guide/shots/11-cabi-live.png) | ![Cabi.NET — 자유 보드와 주간 메모 연동](site/guide/shots/11-cabi-board.png) |

화면은 가상 샘플입니다. [장면별 이용 가이드](https://chs2147.github.io/work-journey-board/guide/)에서 사용 흐름을 확인하세요.

## 설치
[Releases](https://github.com/chs2147/work-journey-board/releases/latest)에서 내려받습니다 — **Windows 10·11 · macOS 13 이상**(1.6.0부터, 같은 판·같은 기능).

| 파일 | 용도 |
|---|---|
| `WorkJourneyBoard_<버전>_setup.exe` | **Windows 기본판**(약 10MB) — WebView2가 없으면 설치 중 자동으로 받음 |
| `WorkJourneyBoard_<버전>_setup_offline.exe` | **Windows 오프라인 설치판**(약 220MB, 올라와 있는 판만) — 인터넷이 막힌 PC용, WebView2 포함 |
| `WorkJourneyBoard_<버전>_mac.dmg` | **macOS**(인텔·애플 실리콘 공용) — 열어서 앱을 응용 프로그램 폴더로 끌어 놓기 |

- Windows: 관리자 권한 없이 **현재 사용자에게만** 설치됩니다.
- macOS: 처음 열면 "'Work Journey Board'을(를) 열지 않음" 창이 뜹니다(애플 개발자 서명이 없는 앱이라 macOS가 막는 것 — 창에는 [휴지통으로 이동]·[완료]만 있음). **[완료]**를 누른 뒤 **시스템 설정 › 개인정보 보호 및 보안**을 열고 맨 아래 **보안** 칸의 "'Work Journey Board'이(가) 차단되었습니다" 옆 **[그래도 열기]** → 암호(또는 Touch ID) → 앱을 다시 열고 한 번 더 뜨는 창에서 **[그래도 열기]**. 처음 한 번만 하면 됩니다(앱 안에서 받은 새 판은 다시 묻지 않음). 단축키는 `Ctrl` 대신 `⌘`, `Alt` 대신 `⌥`.
- 처음 켜면 시그니처 테마(설정 › 화면 › 테마에서 라이트·다크·시스템 설정으로 바꿀 수 있음).
- 새 판이 나오면 앱이 켤 때 알려 주고, 설정 › 업데이트에서 내려받아 설치합니다(SHA256 확인 · 설치 전 일지 자동 백업).

## 기록과 개인정보
- **이 PC 워크스페이스**의 기록과 메모는 사용자가 고른 폴더의 SQLite 일지에 저장됩니다. **온라인 워크스페이스**는 로그인 후 선택해 사용하는 기능으로, 해당 공간의 기록·메모를 서버와 동기화하고 이 기기에도 사본을 저장합니다. [온라인 기능과 데이터 관리 안내](https://chs2147.github.io/work-journey-board/guide/#s16)
- 자동 백업: 매일·매월 · 켜 둔 동안 2시간마다 · 보조 백업 위치(선택). 백업 당시 앱·DB 구조 버전을 이력에 남기고, 보관 일수·용량 규칙으로 백업 파일을 정리합니다. 문제가 생기면 **앱 안에서 백업으로 복원**(지금 파일은 `_before-restore`로 보관, 되돌리기 가능) — 앱을 열 수 없을 때의 수동 절차는 [docs/restore-guide.md](docs/restore-guide.md).

## 문서
| 문서 | 내용 |
|---|---|
| [docs/overview.md](docs/overview.md) | 요구사항 · 설계 결정 이력 · **화면 구성(10절)** · 단축키(10-3절) · 인계 명세(12절) |
| [docs/data-spec.md](docs/data-spec.md) | ISO 주차 · 스키마 SQL · 카테고리 활성/무기록 규칙 · 삭제 · 백업 · 저장소 인터페이스 |
| [docs/output-spec.md](docs/output-spec.md) | 주간 자동 집계 · 엑셀 2시트 양식 · 내보내기 · AI 클립보드 지시문 |
| [docs/viz-spec.md](docs/viz-spec.md) | 업무 타임라인 · 활동 히트맵 · 기간 막대 · 주별 비중 · 업무 색 팔레트 |
| [docs/brand-spec.md](docs/brand-spec.md) | 앱 아이콘 · 워드마크 규칙 · 만드는 방법 |
| [docs/release-phase2-spec.md](docs/release-phase2-spec.md) | 정식 릴리스 준비 — 시그니처 기본값 · 설치 프로그램 그림 · 정식 판/오프라인판 배포 · 만든 이 표시 |
| [docs/optimize-1031-plan.md](docs/optimize-1031-plan.md) | 최적화 · 백업 보강 · 앱 안 복원(v0.4.0) |
| [docs/restore-guide.md](docs/restore-guide.md) | 앱을 열 수 없을 때 백업에서 수동으로 복원하기 |
| [docs/project-plan.md](docs/project-plan.md) | 마일스톤 I-M0~M5 · 관문 G1/G2 |
| [docs/m1-check.md](docs/m1-check.md) | 회사 PC 확인표(판마다) |
| 기능별 상세 설계 | [스플래시](docs/splash-spec.md) · [중요·반복](docs/important-repeat-spec.md) · [주간 메모](docs/weekly-note-spec.md) · [관계선](docs/note-relation-spec.md) · [다중 연결](docs/multi-link-spec.md) · [인사이트 S1](docs/m3-s1-spec.md) · [S2](docs/m3-s2-spec.md) · 개선 [1026](docs/improve-1026-spec.md) · [1026v2](docs/improve-1026v2-spec.md) · [1027v3](docs/improve-1027v3-spec.md) · [1027v4](docs/improve-1027v4-spec.md) · [1027v5](docs/improve-1027v5-spec.md) · [디자인 리뉴얼](docs/renewal/) |
| [docs/wireframes/](docs/wireframes/) · [docs/samples/](docs/samples/) | 와이어프레임 · 엑셀 샘플(가상 데이터) |
| [CLAUDE.md](CLAUDE.md) | 구현 규칙(외부 통신 0 · 실데이터 금지 · 데이터 파일 안전 · 기술 스택) |

## 기술 스택
Tauri v2(NSIS per-user) · React 18 + Vite + TypeScript · SQLite(실앱 tauri-plugin-sql / 개발·테스트 sql.js) · ExcelJS · Three.js(Universe) · Tiptap(블록 편집) · pdf-lib(노트 PDF) · SVG + d3-scale · date-fns · Vitest + Playwright · GitHub Actions(ubuntu CI·macos Rust 검사 + windows-latest NSIS·macos-latest 유니버설 DMG 빌드)

## 사용한 글꼴
- [Pretendard](https://github.com/orioncactus/pretendard) — 라이트·다크 테마 본문. SIL Open Font License 1.1, 공식 배포 파일을 수정 없이 포함 ([라이선스 전문](public/licenses/Pretendard-OFL-1.1.txt))
- [고운돋움](https://github.com/yangheeryu/Gowun-Dodum) — 시그니처 테마 본문. SIL Open Font License 1.1 ([라이선스 전문](public/licenses/GowunDodum-OFL-1.1.txt))

## 개발
```bash
npm ci
npm run dev          # 브라우저 모드(sql.js 메모리) — http://localhost:1420
npm test             # 단위 테스트(Vitest)
npm run e2e          # E2E(Playwright, 브라우저 모드)
npm run perf:mem     # 주 전환 메모리·조회 수 측정(가상 1년치 일지)
npm run lint && npm run format:check && npm run typecheck
npm run tauri dev    # 실앱 모드(윈도우·맥 / 리눅스는 webkit2gtk-4.1 필요)
```
- 브라우저 모드 주소 옵션(E2E·시연): `?today=YYYY-MM-DD` 오늘 고정 · `?empty=1` 빈 일지 · `?fresh=1` 첫 실행 화면 · `?existing=/경로` 그 폴더에 샘플 일지 준비 · `?config=/경로` 설정 폴더 지정 · `?sample=year`(`year-img`) 가상 1년치 일지 · `?sample=showcase` README·소개 사이트 화면용 메모 보드 예시 · `?corrupt=1` 파손 일지
- 설치 파일: `main`에 반영되면 *Build desktop installers*가 윈도우(NSIS)·맥(유니버설 DMG)을 나란히 만들고, **둘 다 성공해야** [Releases](https://github.com/chs2147/work-journey-board/releases)에 `v<버전>`으로 함께 올린다 — 0.x·`-rc`는 사전 릴리스, 1.0.0 이상 정식 판은 정식 릴리스. 윈도우 오프라인 설치판은 요청할 때만 Actions → *Build desktop installers* → Run workflow(main) → `offline`으로 그 판 릴리스에 더한다. 하나의 원본으로 두 플랫폼을 같은 판으로 운영한다([docs/macos-spec.md](docs/macos-spec.md)).

현재 상세 기능과 도입 버전: [Feature List 운영 문서](docs/features/README.md) · [현재 목록](docs/features/CURRENT.md) · [검토용 Excel](docs/features/exports/work-journey-board/Work-Journey-Board-Feature-List-v1.51.0.xlsx)

## Version History

최근 5개 버전(정식·RC)을 표시합니다. [더 보기 — 전체 버전 히스토리](VERSION_HISTORY.md)

### v1.53.3 (2026-11-26) — Open Beta · 기능 둘러보기 소개 카드가 매번 뜨던 문제 수정

- 설정 파일을 읽을 때 코칭 기록을 버려 기존 사용자 ? 단추 소개·환영 카드가 앱을 켤 때마다 뜨던 문제 수정 — 이제 한 번만, 투어 완료·진행 기록도 다시 켜도 남음.
- 투어 시작·? 메뉴 열기로 카드가 사라져도 본 것으로 기록. 구조 v20 유지, 새 의존성·운영 서버 변경 없음, 이전 main 1.53.2는 `release/v1.53.2` 보존.

### v1.53.2 (2026-11-26) — Open Beta · 보안 점검 확정 2건 수정

- Markdown 내보내기(업무 보드·주간 메모)의 이미지 이름에 `..`·`.` 경로 조각이 섞여도 고른 폴더 밖에 쓰지 않음 — 화면·Rust 두 곳 검사, 확장자 고정 목록, 위험한 ID는 번호 이름.
- 온라인 동기화로 받은 기록이 이 기기의 Cabinet 폴더 경로·백업·AI 설정을 덮지 않음. 보안 점검 요약 `docs/security-audit-1126.md`. 구조 v20 유지, 새 의존성·운영 서버 변경 없음, 이전 main 1.53.1은 `release/v1.53.1` 보존.

### v1.53.1 (2026-11-26) — Open Beta · 라이브러리·빌드 도구 판올림, 배포 안정화

- Tiptap 3.35·Three.js 0.187·sql.js 1.17·Zustand 5.1 등 22개 패키지와 GitHub Actions 액션 8종 판올림(Node.js 20 경고 해소), 오픈소스 라이선스 표 판 번호 맞춤. 기능·화면 변화 없음.
- 소개 사이트 배포를 만들기·배포 두 작업으로 나눠 안정화, 기능 둘러보기 E2E 간헐 실패 수정. 구조 v20 유지, 새 의존성 없음, 이전 main 1.53.0은 `release/v1.53.0` 보존.

### v1.53.0 (2026-11-25) — Open Beta · 기능 둘러보기(앱 안 코칭)

- 레일 ?·`F1`·설정 › 업데이트·정보에서 여는 단계별 안내 — 화면을 가리고 대상만 밝혀 말풍선으로 설명, 투어 11가지(시작하기·화면 구성·주간 보드·메모 보드·칸반·인사이트·Universe·중요 업무·Cabi.NET·업무노트·업무 메모보드).
- 늘 가상 예시 화면 위에서(내 일지·설정에 쓰지 않음, 끝나면 보던 화면으로), 업무노트·업무 메모보드는 예시 문서 별도 창 안에서. 새 설치 환영 카드·업데이트 사용자 ? 단추 소개 각 1회, 화면별 제안.
- 구조 v20 유지, 새 의존성·운영 서버 변경 없음, 이전 main 1.52.1은 `release/v1.52.1` 보존.

### v1.52.1 (2026-11-23) — Open Beta · 보안 점검 알림 2건 정리

- 업무노트 Markdown 가져오기의 HTML → 글자 변환을 한 글자씩 읽기로(꺾쇠·script·style 안 버림, CodeQL #11), V2 설계 시안 장면 이름은 허용 목록 값만(#4).
- main 패치, 구조 v20 유지, 새 의존성·운영 서버 변경 없음, 이전 main 1.52.0은 `release/v1.52.0` 보존.

[더 보기 — 전체 버전 히스토리](VERSION_HISTORY.md)

---

<div align="center">

<sub>Made by</sub>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/m1-en-reverse.svg">
  <img src="docs/brand/m1-en-color.svg" alt="sanbonjini" height="40">
</picture>

Copyright 2026 sanbonjini · [브랜드 사이트](https://sanbonjini.vercel.app)

<sub>sanbonjini 로고는 브랜드 자산 사용 정책을 따르며 이 저장소의 코드 라이선스와 별개입니다.</sub>

</div>
