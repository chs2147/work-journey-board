# 저장소 비공개(private) 전환 — 영향 점검과 준비 사항

> 2026-11-13 작성 · 기준 판 v1.40.0 · **상태: 점검(검토용) — 결정 전에는 아무것도 바꾸지 않음**
> 대상: `chs2147/work-journey-board`를 public → private으로 바꿀 때 배포·새 판 확인·소개 사이트·CI·문서가 받는 영향과 준비 순서

## 0. 요약

| 구성 요소 | 비공개로 바꾸면 | 심각도 |
|---|---|---|
| **설치된 앱의 새 판 확인·설치**(`update.rs`) | GitHub API·`releases/latest`·설치 파일 주소가 로그인 없이 **404** → 모든 설치본이 새 판을 못 찾음("업데이트 확인 실패"로 안내, 앱 동작·일지는 영향 없음) | **높음** |
| **내려받기 링크**(소개 사이트·README·이용 가이드 01) | `releases/latest`가 남에게 404 — 본인도 GitHub 로그인한 브라우저에서만 받음 | **높음** |
| **소개 사이트(GitHub Pages)** | 개인 무료 계정은 private 저장소에서 Pages를 못 씀 → 사이트 내려감. **GitHub Pro**면 유지(사이트 자체는 계속 공개) | **높음** |
| **GitHub Actions 사용 시간** | public은 무료·무제한 → private은 월 포함 시간(무료 2,000분·Pro 3,000분) 차감, **macOS 10배·Windows 2배** 환산 | **높음** |
| Actions 아티팩트·패키지 저장 용량 | private은 저장 용량 한도(무료 500MB) 적용 — 설치 파일 아티팩트(오프라인판 약 220MB) 누적 주의 | 중간 |
| 앱 안 링크(릴리스 노트·소개 사이트·이용 가이드) | 릴리스 노트(`releases/tag/v…`)는 404, 사이트·가이드는 Pages 결정에 따름 | 중간 |
| README·Feature List의 GitHub 링크 | 저장소 안에서 보는 본인에게는 그대로, 외부 공유 링크는 404 | 낮음 |
| 별(star)·지켜보기·공개 포크 | 비공개 전환 때 별·지켜보기는 지워지고 공개 포크는 떨어져 나감(GitHub 정책) | 낮음 |
| Claude Code 세션·GitHub 연결 | 영향 없음(이미 로그인 권한으로 접근) | 없음 |
| 일지 데이터·외부 통신 0 원칙 | 영향 없음 | 없음 |

**핵심**: 소스만 숨기고 배포·사이트·새 판 확인은 지금처럼 쓰려면 **공개 배포 전용 저장소**(예: `chs2147/work-journey-board-releases`)를 따로 두고, **비공개 전환 전에** 새 주소를 아는 "다리 판"을 배포해 설치본을 옮겨 두어야 한다(4절).

## 1. 지금 GitHub 공개에 기대는 곳 (코드 위치)

| 위치 | 쓰는 주소 | 비공개 뒤 |
|---|---|---|
| `src-tauri/src/update.rs` `RELEASES_API` | `api.github.com/repos/chs2147/work-journey-board/releases?per_page=10` (로그인 없음) | 404 → `classify`가 "확인 실패(404)"로 안내 |
| `update.rs` `LATEST_PAGE` (403/429 대체 경로, D8) | `github.com/…/releases/latest` 이동 주소 | 404 |
| `update.rs` `DOWNLOAD_PREFIX`·허용 접두어 | `github.com/…/releases/download/` | 404 |
| `src-tauri/src/update_policy.rs` `ABS` + `cargo test` | `github.com/…/releases/tag/v` (릴리스 노트 열기 허용 주소) | 404 |
| `src/shared/strings.ts` `releasesUrl`·`notesUrl` | 릴리스 페이지·태그 | 404 |
| `src/shared/strings.ts` `siteUrl`·`guideUrl` | `chs2147.github.io/work-journey-board/` | Pages 결정에 따름 |
| `site/index.html` 내려받기 4곳·GitHub 링크 2곳·`canonical`·`og:*` | 릴리스·저장소·Pages | 내려받기·저장소 링크 404 |
| `scripts/guide/guide.mjs` `SITE_URL`·`og:*` · `docs/guide/01-setup.md` 내려받기 2곳 | Pages·릴리스 | 위와 같음 |
| `README.md` 내려받기·Releases 링크 | 릴리스 | 외부 공유 시 404 |
| `scripts/features/generate.mjs` 근거 링크 | `github.com/…/blob|tree/v<판>/…` | 본인만 열림 |
| `.github/workflows/build-desktop.yml` | 같은 저장소에 `GITHUB_TOKEN`으로 릴리스 게시 | 그대로 동작(대신 사용 시간 차감) |
| `.github/workflows/pages.yml` | 같은 저장소 Pages 배포 | 무료 계정이면 실패 |

## 2. Actions 사용 시간 추정 (v1.40.0 main 실행 기준)

| 실행 | 작업(실제 분) | 환산 분(배수) |
|---|---|---|
| CI | web ubuntu 26 · perf ubuntu 2 · rust-macos 1 | 26 + 2 + 10 ≈ **38** |
| Build desktop | macos 7 · windows 5 · ubuntu 1 | 70 + 10 + 1 ≈ **81** |
| 합계(코드 푸시 1번) | | **약 120분** |

- 무료 2,000분이면 코드 푸시 **약 16번**, Pro 3,000분이면 약 25번에 한 달 한도가 찬다. 지금까지 3주 동안 워크플로 실행이 240회를 넘었다(작업 브랜치 자동 빌드 포함) → **그대로면 한도를 크게 넘는다**.
- 배수·포함 시간은 GitHub 요금 정책에 따라 바뀔 수 있으니 전환 전 설정 › Billing에서 확인한다.
- 줄이는 방법(조합 가능):
  1. 설치 파일 자동 빌드를 **main + 수동 실행만**(작업 브랜치 자동 빌드 목록 `claude/**`·`improve-v*` 제거 — rc는 수동 실행)
  2. CI e2e는 브랜치에서 Chromium만, WebKit은 main만
  3. `rust-macos`를 CI에서 빼고 설치 파일 빌드의 macOS 단계 `cargo test`로 대신(이미 같은 시험을 돎)
  4. 아티팩트 보관 기간 짧게(`retention-days`), 오프라인판은 지금처럼 요청할 때만

## 3. 선택지

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| **A. 공개 배포 저장소 분리 (추천)** | 소스 = private `work-journey-board`, 배포 = public `work-journey-board-releases`(릴리스 + 소개 사이트 Pages). 빌드는 private에서 하고, 릴리스는 범위를 그 저장소로 좁힌 토큰(Secret)으로 공개 저장소에 올린다 | 새 판 확인·내려받기·사이트가 지금과 같은 방식(로그인 없음), 무료 계정으로 Pages 가능, 앱에 비밀 값 없음 | 앱 업데이트 주소 변경(4-1 승인 필요)·다리 판 1회·토큰 관리·사이트 주소 변경(`…github.io/work-journey-board-releases/` 또는 맞춤 도메인) |
| B. 전부 private + GitHub Pro | Pages는 Pro로 유지, 릴리스는 비공개 | 저장소 하나 | **설치된 앱 새 판 확인 불가**(앱에 토큰을 넣는 것은 금지 수준의 위험), 남은 내려받기 불가 — 사실상 배포 중단 |
| C. 공개 유지 | 지금 그대로 | 변경 없음·Actions 무료 | 소스 공개 유지 |
| D. 배포처를 GitHub 밖으로 | 다른 호스팅에 설치 파일·판 목록 | 저장소 하나 | 새 외부 호스트 = 4-1 원칙 변경·CSP 밖이지만 `update.rs` 허용 주소 확대 승인, 운영 부담 큼 |

## 4. A안 준비 순서 (비공개 전환 **전에** 끝내야 하는 것)

1. **공개 배포 저장소 만들기** — `chs2147/work-journey-board-releases`(README 한 장·라이선스 안내만, 소스 없음).
2. **토큰 Secret** — 그 저장소에만 `contents: write`(필요하면 `pages: write`) 권한인 fine-grained 토큰을 private 저장소 Secret으로(예: `RELEASES_TOKEN`). 만료일·갱신 메모를 남긴다.
3. **워크플로 바꾸기**
   - `build-desktop.yml` release 작업: 릴리스·자산을 배포 저장소에 게시(`gh release create --repo chs2147/work-journey-board-releases`, 토큰 = Secret). 태그도 그쪽에.
   - `pages.yml`: `site/`를 배포 저장소로 내보내 그쪽 Pages로 게시(또는 배포 저장소의 자체 워크플로). Pro를 쓰면 지금 저장소 Pages 유지도 가능.
   - 2절의 사용 시간 줄이기 적용.
4. **앱 주소 바꾸기(사용자 승인 필요 — CLAUDE.md 4-1 "주소·시점을 넓히려면 승인")**
   - `update.rs` `RELEASES_API`·`LATEST_PAGE`·`DOWNLOAD_PREFIX`·허용 접두어 → 배포 저장소, `update_policy.rs` `ABS`, `strings.ts` `releasesUrl`·`notesUrl`(+ 사이트 주소가 바뀌면 `siteUrl`·`guideUrl`), `cargo test`·단위 시험 갱신.
   - 같은 호스트(github.com)·같은 방식(로그인 없음·SHA256 확인)이고 저장소 이름만 바뀐다. 사용자 데이터 전송 없음.
5. **다리 판(예: 1.40.1) 배포** — 4번이 들어간 판을 **지금 공개 저장소와 배포 저장소 양쪽에** 게시한다. 옛 설치본은 지금 저장소에서 다리 판을 찾아 설치하고, 그 뒤로는 새 주소를 본다.
6. **설치본 옮기기 확인** — 회사 PC·맥에서 다리 판 설치 → 설정 [업데이트 확인]이 배포 저장소를 보는지(다음 판이 나오면 찾는지) 확인. 다른 사람이 쓰고 있다면 안내 기간을 둔다.
7. **링크 정리** — 소개 사이트 내려받기·GitHub 링크(저장소 링크는 빼거나 배포 저장소로), `canonical`·`og:*`, 이용 가이드 01, README 내려받기, `guide.mjs` `SITE_URL` → 가이드 다시 생성.
8. **옛 저장소 릴리스 처리** — 지난 판 설치 파일이 필요하면 배포 저장소로 옮겨 둔다(최근 몇 판만이라도). 전환 뒤 옛 주소는 남에게 404.
9. **비공개 전환** — 설정 › General › Danger Zone › Change visibility. 전환 직후 CI·설치 파일 빌드·사이트 배포를 한 번씩 돌려 확인.
10. **문서** — CLAUDE.md 4-1 새 판 확인 예외의 주소, 2절 CI 표, `docs/release-notes/` 안내 문구(배포 위치), 이 문서의 결정 기록.

### 다리 판을 건너뛰면
- 이미 설치된 1.40.0 이하는 새 판을 영원히 못 찾는다(앱은 "업데이트 확인 실패"만 보임). 각 PC에서 소개 사이트(배포 저장소)의 설치 파일로 **수동 설치**해야 옮겨진다. 설치·일지 데이터에는 문제가 없다.

## 5. 결정 항목 (추천 굵게)

| # | 항목 | 추천 |
|---|---|---|
| P1 | 방향 | **A안 공개 배포 저장소 분리** (대안 C 공개 유지) |
| P2 | 배포 저장소 이름 | **`work-journey-board-releases`** |
| P3 | 소개 사이트 위치 | **배포 저장소 Pages**(주소 `chs2147.github.io/work-journey-board-releases/`) · 대안: Pro로 지금 주소 유지 · 맞춤 도메인 |
| P4 | 앱 업데이트 주소 변경 | **배포 저장소로 변경 승인**(같은 github.com, 로그인 없음, SHA256 확인 그대로) |
| P5 | 다리 판 | **1.40.1**(기능 변화 없음, 주소만) — 양쪽 저장소 게시 |
| P6 | 사용 시간 줄이기 | **설치 파일 자동 빌드 = main + 수동만 · rust-macos는 빌드 단계로 · 아티팩트 보관 7일** |
| P7 | 옛 릴리스 | **최근 정식판 3개(1.30.0·1.35.0·1.40.0) 설치 파일만 배포 저장소로 복사** |
| P8 | 계정 요금제 | 무료 유지 가능(A안) — 사용 시간이 모자라면 Pro 검토 |
