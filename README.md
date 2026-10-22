# Work Journey Board

요일 단위 주간 보드에 업무별로 개조식 기록을 남기면 **주간 요약 · 진행 경과 시각화 · 엑셀 보고서**가 자동으로 만들어지는 개인 업무 일지.
회사 윈도우 PC 단독 사용, **외부 통신 0**, 데이터는 사용자가 고른 폴더의 SQLite 파일 1개.

> 본질: **입력은 최대한 가볍게, 산출물은 자동으로.**

## 상태
- 상세설계 D1~D5 완료(2026-10-22) — 설계 저장소 [my-discussions](https://github.com/chs2147/my-discussions)에서 이 저장소로 이관. **이후 정본은 이 저장소.**
- 다음: **I-M0 회사 PC 설치 검증 → ◆G1 판정** → I-M1 핵심 기록

## 문서
| 문서 | 내용 |
|---|---|
| [docs/overview.md](docs/overview.md) | 요구사항(R1~R10) · 설계 결정 이력 · **화면 구성(10절)** · 상세 설계 요약(11절) · **인계 명세(12절)** |
| [docs/data-spec.md](docs/data-spec.md) | ISO 주차 · 스키마 SQL · 카테고리 활성/무기록 규칙 · 삭제 · 백업 · 저장소 인터페이스 |
| [docs/output-spec.md](docs/output-spec.md) | 주간 자동 집계 · 엑셀 2시트 양식 · 내보내기 UX · AI 클립보드 지시문 |
| [docs/viz-spec.md](docs/viz-spec.md) | 경과 타임라인 · 활동 히트맵 · 기간 막대 · 주별 비중 · 업무 색 팔레트 |
| [docs/project-plan.md](docs/project-plan.md) | 작업 패키지 · 관문(G1/G2) · 마일스톤 I-M0~M5 · 세션 시작 프롬프트 |
| [docs/wireframes/](docs/wireframes/) | 주간 보드 · 첫 실행/연간 보기 · 인사이트 와이어프레임 |
| [docs/samples/](docs/samples/) | 엑셀 내보내기 샘플(가상 데이터) |
| [CLAUDE.md](CLAUDE.md) | 구현 규칙(외부 통신 0 · 실데이터 금지 · 데이터 파일 안전 · 기술 스택) |

![주간 보드 와이어프레임](docs/wireframes/wireframe-weekly-board.svg)

## 기술 스택 (확정)
Tauri v2(NSIS per-user) · React 18 + Vite + TypeScript · SQLite(실앱 tauri-plugin-sql / 개발·테스트 sql.js) · ExcelJS · SVG + d3-scale · date-fns · Vitest + Playwright · GitHub Actions(ubuntu CI + windows-latest 설치 파일 빌드)

## Version History
(첫 릴리스 전)
