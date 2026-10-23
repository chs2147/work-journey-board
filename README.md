# Work Journey Board

요일 단위 주간 보드에 업무별로 개조식 기록을 남기면 **주간 요약 · 진행 경과 시각화 · 엑셀 보고서**가 자동으로 만들어지는 개인 업무 일지.
회사 윈도우 PC 단독 사용, **외부 통신 0**, 데이터는 사용자가 고른 폴더의 SQLite 파일 1개.

> 본질: **입력은 최대한 가볍게, 산출물은 자동으로.**

## 상태
- 상세설계 D1~D5 완료(2026-10-22) — 설계 저장소 [my-discussions](https://github.com/chs2147/my-discussions)에서 이 저장소로 이관. **이후 정본은 이 저장소.**
- **I-M0 완료 · ◆G1 GO**(2026-10-23): 회사 PC에서 관리자 권한 없이 설치·실행, WebView2 있음, 사용자 폴더 SQLite 전 항목 통과 → Tauri 구조 확정 ([docs/overview.md 13절](docs/overview.md))
- 다음: **I-M1 핵심 기록** — 계획 [docs/i-m1-plan.md](docs/i-m1-plan.md) (S1 골격 → S2 도메인·데이터 → S3 보드·입력 → S4 플랫폼·첫 실행·백업 → S5 검증·v0.1.0)

## 문서
| 문서 | 내용 |
|---|---|
| [docs/overview.md](docs/overview.md) | 요구사항(R1~R10) · 설계 결정 이력 · **화면 구성(10절)** · 상세 설계 요약(11절) · **인계 명세(12절)** |
| [docs/data-spec.md](docs/data-spec.md) | ISO 주차 · 스키마 SQL · 카테고리 활성/무기록 규칙 · 삭제 · 백업 · 저장소 인터페이스 |
| [docs/output-spec.md](docs/output-spec.md) | 주간 자동 집계 · 엑셀 2시트 양식 · 내보내기 UX · AI 클립보드 지시문 |
| [docs/viz-spec.md](docs/viz-spec.md) | 경과 타임라인 · 활동 히트맵 · 기간 막대 · 주별 비중 · 업무 색 팔레트 |
| [docs/m0-install-check.md](docs/m0-install-check.md) | I-M0 회사 PC 설치 검증 절차 · ◆G1 판정 기준 |
| [docs/i-m1-plan.md](docs/i-m1-plan.md) | I-M1 핵심 기록 구현 계획(세션 S1~S5) |
| [docs/project-plan.md](docs/project-plan.md) | 작업 패키지 · 관문(G1/G2) · 마일스톤 I-M0~M5 · 세션 시작 프롬프트 |
| [docs/wireframes/](docs/wireframes/) | 주간 보드 · 첫 실행/연간 보기 · 인사이트 와이어프레임 |
| [docs/samples/](docs/samples/) | 엑셀 내보내기 샘플(가상 데이터) |
| [CLAUDE.md](CLAUDE.md) | 구현 규칙(외부 통신 0 · 실데이터 금지 · 데이터 파일 안전 · 기술 스택) |

![주간 보드 와이어프레임](docs/wireframes/wireframe-weekly-board.svg)

## 기술 스택 (확정)
Tauri v2(NSIS per-user) · React 18 + Vite + TypeScript · SQLite(실앱 tauri-plugin-sql / 개발·테스트 sql.js) · ExcelJS · SVG + d3-scale · date-fns · Vitest + Playwright · GitHub Actions(ubuntu CI + windows-latest 설치 파일 빌드)

## 개발
```bash
npm ci
npm run dev          # 브라우저 모드(sql.js 메모리) — http://localhost:1420
npm test             # 단위 테스트(Vitest)
npm run e2e          # E2E(Playwright, 브라우저 모드)
npm run lint && npm run format:check && npm run typecheck
npm run tauri dev    # 실앱 모드(윈도우 / 리눅스는 webkit2gtk-4.1 필요)
```
- 윈도우 설치 파일: `main`에 반영되면 [Releases](https://github.com/chs2147/work-journey-board/releases)에 `v<버전>` 사전 릴리스로 올라간다. WebView2 오프라인 설치판은 Actions → *Build Windows installer* → Run workflow → `offline`.

## Version History
### v0.0.1 (2026-10-23) — I-M1 S1 프로젝트 골격
- React 18 + Vite + TypeScript 앱 골격, 디자인 토큰·업무 색 팔레트·UI 문자열 단일 출처
- SQL 드라이버 인터페이스 + sql.js(브라우저 모드)·tauri-plugin-sql(실앱) 드라이버
- Tauri v2 껍데기: 단일 인스턴스·창 상태 기억, 외부 통신 차단 CSP, NSIS 현재 사용자 설치, WebView2 embedBootstrapper
- CI(lint·포맷·타입·단위·E2E)와 윈도우 설치 파일 빌드·사전 릴리스 워크플로(오프라인 설치판 선택 가능)
