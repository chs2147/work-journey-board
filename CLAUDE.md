# CLAUDE.md — Work Journey Board

> 2026-10-22 설계 저장소 my-discussions(`topics/10 work-journal-board/impl-CLAUDE.md`)에서 작성한 초안을 옮겨왔다. **이후 설계·구현 문서는 이 저장소가 정본이며 my-discussions에는 동기화하지 않는다.**
> 보편 규칙(브랜치 안내·문서 동반 갱신·검증 방법론·UI 기본기·DB 안전 등)은 전역 `~/.claude/CLAUDE.md`(정본: my-discussions `topics/8 common-vibe-coding-rules/common-claude-rules.md`)를 따른다. **이 파일에는 이 프로젝트 고유 규칙만** 둔다.

## 1. 프로젝트 개요
- **Work Journey Board** — 요일 단위 주간 보드에 사용자 정의 업무별로 개조식 기록 → 주간 요약·정성적 경과 시각화·엑셀이 자동으로 나오는 개인 업무 일지.
- 대상: **회사 윈도우 PC 단독**, per-user 설치, **외부 통신 0**, 데이터 = 사용자가 고른 폴더의 SQLite 파일 1개.
- 스펙 원본(이 저장소 `docs/`):
  | 문서 | 내용 |
  |---|---|
  | `overview.md` | 요구사항·결정 이력·**10절 화면 구성**·**12절 인계 명세** |
  | `data-spec.md` | 주차 규칙·스키마 SQL·활성/무기록 규칙·삭제·백업·저장소 인터페이스 |
  | `output-spec.md` | 자동 집계 포맷·엑셀 2시트·내보내기·AI 지시문 |
  | `viz-spec.md` | 4개 시각화·업무 색 팔레트 |
  | `splash-spec.md` | 시작 스플래시 창(창 2개 흐름·최소 표시 시간·안전장치·시안) |
  | `important-repeat-spec.md` | 중요 표시(B안)·중요 업무 패널·매주 반복(R1)·왼쪽 메뉴 레일(M1) 상세 설계 |
  | `weekly-note-spec.md` | 주간 메모(요일 메모 → 주 1개 자유 메모: 자유 배치 상자·리치 서식·이미지) 상세 설계 — 2026-10-25 확정(시안 A·메모 도크), 구현 N1~N3 |
  | `brand-spec.md` | 앱 아이콘(노트·책갈피, 작은 판)·워드마크(그로테스크 + 손글씨 Journey, SVG 도형) — 생성 도구 `scripts/brand/` |
  | `wireframes/` | 주간 보드·첫 실행/연간 보기·인사이트·스플래시 와이어프레임(svg)·스플래시 창 화면(png) |
  | `samples/*.xlsx` | 엑셀 내보내기 양식 샘플 · 기존 일지 가져오기 양식 샘플(가상 데이터) |
  | `project-plan.md` | 마일스톤 I-M0~M5·관문 G1/G2 |
  | `i-m1-plan.md` · `i-m2-plan.md` · `i-m3-plan.md` | 마일스톤별 세션 계획(I-M1 완료, I-M2 주간 요약·엑셀, I-M3 기존 일지 가져오기 + 시각화) |
  | `m1-check.md` · `g2-log.md` | 회사 PC 확인표(I-M1 v0.1.0 · I-M2 v0.2.0 7-2절) · ◆G2 실사용 마찰 기록 양식 |
- **스펙과 다르게 구현해야 하면** 먼저 사용자에게 묻고, 확정되면 같은 작업 안에서 `docs/` 스펙도 함께 갱신한다(스펙이 정본).

## 2. 기술 스택
| 영역 | 선택 |
|---|---|
| 껍데기 | **Tauri v2**, NSIS **per-user**(`bundle.windows.nsis.installMode = "currentUser"`), WebView2 `embedBootstrapper`(예비: `offlineInstaller` 수동 빌드) |
| 화면 | React 18 + Vite + TypeScript(strict) |
| 상태 | Zustand(화면 상태) — 영속 데이터는 항상 저장소 경유 |
| 스타일 | CSS Modules + `src/shared/tokens.css` 디자인 토큰(라이트/다크) |
| 저장 | SQLite. 실앱 `tauri-plugin-sql` / 개발·테스트 **sql.js(SQLite WASM)** — **같은 스키마·마이그레이션 SQL** |
| 날짜 | date-fns(ISO 주차 함수) — 주차 계산은 `src/domain/week.ts` 한 곳 |
| 엑셀 | ExcelJS |
| 차트 | 직접 SVG + d3-scale/d3-array |
| Tauri 플러그인 | sql · dialog(폴더 선택·저장) · fs(저장 폴더 범위만) · clipboard-manager · single-instance · opener(폴더 열기) · window-state |
| 테스트 | Vitest(+Testing Library), Playwright(브라우저 모드 E2E·스크린샷 — Chromium 기준 + WebKit 보험) |
| 품질 | ESLint + Prettier, `tsc --noEmit` |
| CI | GitHub Actions: `ci.yml`(ubuntu: lint·typecheck·test·e2e) / `build-windows.yml`(windows-latest, main 빌드 → `v<버전>` 사전 릴리스 생성·갱신, 수동 실행 시 오프라인 설치판 선택) |

## 3. 디렉토리 구조
```
src/
  domain/     week.ts · categories.ts(활성 계산) · nudge.ts(무기록 판정) · aggregate.ts(자동 집계) · insights.ts
              → 순수 함수만. UI·저장소·플랫폼 import 금지
  data/       driver.ts(SqlDriver) · drivers/tauriSql.ts · drivers/sqlJs.ts · repository.ts · migrations/0001_init.sql …
  export/     excel.ts · filename.ts · importTemplate.ts(가져오기 양식)
  import/     readTable.ts(가져올 엑셀·CSV·붙여넣은 글 읽기 — 읽기만)
  platform/   index.ts(인터페이스) · tauri.ts · browser.ts · fakeFs.ts(브라우저 모드 가짜 폴더)   ← 폴더 선택·설정·백업 파일·OneDrive 감지
  ui/         board/ · summary/ · insights/ · settings/ · first-run/ · common/
  shared/     strings.ts(UI 문자열 SSOT) · tokens.css · palette.ts(c1~c8)
src-tauri/    얇은 껍데기: 플러그인 등록·설정·CSP + 최소 명령(db_batch.rs 트랜잭션, files.rs 파일·설정). 업무 로직 금지
tests/        unit/ · e2e/
fixtures/     sample-*.json — 가상 업무 기록만
```

## 4. 이 프로젝트 고유 규칙

### 4-1. 외부 통신 0 (제품의 존재 이유)
- 앱 코드에서 외부 호스트로 가는 `fetch`·XHR·WebSocket·이미지/폰트 CDN 로드를 **넣지 않는다**. 본문 글꼴은 **Pretendard Variable**(SIL OFL 1.1) — npm `pretendard`(버전 고정)의 공식 woff2를 **수정 없이** 번들한다(`src/shared/fonts.css`, 라이선스 `public/licenses/`). OFL 예약 글꼴 이름 조항 때문에 글자 잘라내기 등 파일 수정 금지. 기본 글자 크기 14px(`--fs-md`).
- Tauri CSP: `default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' data:; style-src 'self' 'unsafe-inline'`. 외부 도메인을 CSP에 추가하는 변경은 **사용자 승인 필수**.
- 자동 업데이트(updater)·텔레메트리·오류 리포팅 SDK·분석 도구 금지.
- 새 의존성 추가 시 런타임 네트워크 호출 여부를 확인하고 PR/커밋 설명에 적는다.
- AI API 모드(③)는 M4 이후 별도 승인 단계에서만 다룬다(그 전까지 코드 경로 없음). 클립보드 다리는 네트워크를 쓰지 않는다.

### 4-2. 실제 업무 기록 금지
- 저장소·테스트·스크린샷·이슈·커밋 메시지에 **실제 업무 내용을 넣지 않는다**. 테스트·시연은 `fixtures/`의 가상 샘플만.
- `.gitignore`에 `*.db`, `*.db-journal`, `backups/`, `exports/`, `*.xlsx`(`fixtures/`·`docs/samples/`는 예외로 명시) 포함.

### 4-3. 데이터 파일 안전
- 영속 데이터 접근은 **`JournalRepository` → `SqlDriver`** 경로만. UI·domain에서 SQL 직접 실행 금지.
- 사용자 폴더의 파일을 지우는 코드는 **`src/data/backup.ts`의 가드 함수 1곳뿐**이며, data-spec 7-2절의 일일·월간 패턴과 앱이 만든 임시 사본(`*.db.tmp`)만 삭제한다. 실앱에서는 Rust `fs_remove_backup`·`fs_rename_backup`(src-tauri/src/files.rs)이 같은 패턴을 **한 번 더** 검사한다 — 두 곳의 규칙을 함께 바꾸고, 패턴 외 파일 보존 테스트(TS 단위·Rust `cargo test`)를 반드시 통과.
- 사용자 폴더에 쓰는 동작은 `Platform`(src/platform/) 인터페이스로만 한다. 덮어쓰기는 백업 사본 이름 바꾸기와 설정 파일 쓰기뿐이고, 일지 파일·다른 파일은 덮어쓰지 않는다(옮기기는 대상에 일지가 있으면 실패).
- **내보내기 파일 예외(2026-10-24 사용자 확정, i-m2-plan 6절 #5)**: 엑셀(`.xlsx`)은 **사용자가 저장 대화상자에서 고른 경로**에만 쓰고, 같은 이름이 있으면 윈도우 대화상자의 덮어쓰기 확인을 따른다. 확장자 `.xlsx` 외, 저장 폴더의 일지 파일, `backups\` 안은 거부 — Rust 쓰기 명령에서도 한 번 더 검사한다.
  - **주간 메모 이미지 저장(2026-10-25 사용자 확정, weekly-note-spec 11절 #3)**: 메모 이미지 상자의 [이미지로 저장…]도 같은 규칙으로 `.png`·`.webp`를 허용한다(저장 대화상자에서 고른 경로만, 일지 파일·`backups\` 거부, Rust 재검사). 메모 이미지 자체는 일지 파일 안(`note_asset`)에 저장하고 사용자 폴더에 따로 두지 않는다. 구현: `Platform.writeExport`(src/platform) + Rust `export_write`의 `EXPORT_EXTS`(v0.2.2).
- **기존 일지 가져오기(v0.2.4, i-m3-plan 3-9)**: 가져올 파일·붙여넣은 글은 **읽기만**(웹 표준 파일 선택, 새 Rust 명령 없음). 쓰기 직전 `_pre-import` 자동 백업 → `JournalRepository.applyImport` 한 batch. 덮어쓰기는 일지 안의 행을 바꾸는 것(사용자 폴더 파일 삭제 아님)이며 되돌리기 자료(`import_batch.undo_json`)를 함께 남긴다.
- 여러 문장을 묶는 쓰기는 **`SqlDriver.batch`로만** 한다. `BEGIN`/`COMMIT`을 `execute`로 따로 보내지 않는다(실앱 연결 풀 문제, data-spec 8-1).
- 스키마 변경 = 새 마이그레이션 파일(전진 전용) + **마이그레이션 직전 자동 백업** + fixture DB 왕복 테스트. 기존 마이그레이션 파일 수정 금지.
- `PRAGMA journal_mode=DELETE` 유지(WAL 금지 — 데이터 = 파일 1개 원칙).

### 4-4. 도메인 규칙의 단일 출처
- 주차: `domain/week.ts`만. SQL `strftime('%W')` 금지.
- 카테고리 활성·무기록 판정·자동 집계 포맷은 각 domain 모듈만 — 엑셀·시각화·패널이 같은 함수를 재사용.
- 자동 집계는 output-spec 2-2절 샘플과 **문자 단위 골든 테스트**로 고정.

### 4-5. 얇은 Tauri 껍데기
- 기능의 80~90%는 **브라우저 모드(`npm run dev`, sql.js + 샘플 시드)** 에서 개발·테스트한다(클라우드 리눅스 세션 전제).
- 플랫폼 차이는 `src/platform/`의 인터페이스 뒤로만. Rust 코드는 플러그인 등록·설정 위주, 커맨드가 필요하면 최소한으로.
- **윈도우에서만 확인 가능한 항목**(마일스톤마다 회사 PC에서 확인): 설치·실행, 폴더 선택 대화상자, OneDrive 경로 감지, 파일 저장·백업, WebView2 화면, 엑셀 열기.

### 4-6. 입력 UX 우선
- 매일 기록이 **2분 이내**여야 한다(◆G2). 키보드만으로 오늘 칸 기록이 끝나야 하며, 입력 지연·포커스 이탈·저장 실패는 최우선 버그.
- 단축키 표(`docs/overview.md` 10-3절)를 바꾸면 화면 도움말과 그 표를 함께 갱신.

## 5. 명령
```bash
npm run dev          # 브라우저 모드(sql.js, 가상 샘플 시드) — 클라우드 세션 기본
npm run tauri dev    # 실앱 모드(윈도우 로컬 전용)
npm test             # Vitest
npm run e2e          # Playwright(브라우저 모드) — Chromium + WebKit
npm run e2e:chromium # WebKit을 받을 수 없는 클라우드 세션용(두 엔진은 CI에서)
npm run lint && npm run typecheck
```

## 6. 버전·Git
- 버전 정본 = `package.json` `version`, **semver**(`1.0.0`) — Tauri·NSIS가 semver를 요구하므로 공통 규칙의 소수 4자리 관례 대신 semver를 쓴다. `tauri.conf.json`은 `"version": "../package.json"`으로 참조.
- 판올림은 `main` 병합 시점에 사용자에게 묻는다(현재 버전 + 추천 버전 제시). 확정 시 같은 커밋에서 README **Version History** 기록.
- Git: **기본 정책(커밋·푸시·머지 전 사용자 확인)** — 코드·설정·워크플로 변경에 적용.
- **예외(2026-10-23 사용자 지시)**: `docs/`·`README.md`·`CLAUDE.md` 등 **문서만 바뀌는 변경**은 확인 없이 `main`에 바로 커밋·푸시한다. 코드가 함께 바뀌면 기본 정책을 따른다.
- 릴리스 = `main` 빌드가 `package.json` 버전으로 `v<버전>` 릴리스·태그를 **워크플로가 직접** 만든다(세션에서 태그 푸시가 막혀 있음). "운영 반영" = 회사 PC에 설치 파일 설치.
- **오프라인 설치판(`webview=offline` 수동 실행)은 평소 빌드에 포함하지 않는다.** 빌드할 때마다 **먼저 사용자에게 확인한 뒤** 실행한다(2026-10-23 사용자 지시). 기본 설치 파일 빌드(푸시 시 자동)는 그대로다.

## 7. 마일스톤 (project-plan.md)
I-M0 설치 검증(◆G1) → I-M1 핵심 기록(◆G2 2주 실사용) → I-M2 집계·엑셀 → I-M3 시각화 → I-M4 AI 클립보드 다리 → I-M5 안정화·v1.0.0
