# 71. main 1.24.3 반영·V2 재개 체크포인트

2026-11-10 UTC · v2-design · 사용자 요청 main → 현재 브랜치 동기화

## 반영 결과

V2의 최신 작업 `8dde178`을 유지하고 `origin/main`의 `30a4a9a`까지 새 커밋 4개를 충돌 없이 병합했다. 병합 커밋은 **`5bdd4f3`**다. 앱 기준은 **1.24.3**, DB 구조는 **19 유지**다. main으로 역병합·새 판올림·릴리스·설치판 배포는 수행하지 않는다.

| 커밋 | 반영 사항 |
|---|---|
| b2e53ef | 1.24.2: 사진 크게 보기를 dialog 최상위 모달로 변경, 배경 inert/단축키 차단. 데일리 전체 가져오기 버튼 제거, Alt+Shift+P 유지 |
| 8499d9c | 1.24.3: 크게 보기 메모보드의 도구 팔레트를 도크 기준으로 배치 |
| c8239dd | 티저 사이트의 별도 만든 이 영역을 없애고 푸터 한 줄로 브랜드 표시 통합 |
| 30a4a9a | 티저 사이트 우측 하단 모션 정지 버튼 제거. 시스템 reduced-motion 대응 유지 |

README/전체 버전 이력·릴리스 노트·가이드·Feature List/Excel·UI 회귀 테스트도 main 버전으로 함께 반영했다. 제품 `src/src-tauri/site/package*`와 기능 문서는 main과 동일한 것을 확인했다. CLAUDE.md는 main의 새 릴리스 목록과 V2의 로컬 영구 유지 원칙을 모두 보존했다.

## V2 호환성 점검

이번 main 변경에는 DB migration·저장 형식·새 의존성·native 설정·업데이트 경로 변경이 없다. V2 DB18/19 추출·매핑·이미지 분리·registry·A안 실행 분기 계약을 변경할 필요가 없다. 로컬 원본의 구조를 온라인용으로 바꾸거나 온라인 기능을 자동 초기화하지 않는다. DEV/PROD DB/Storage/KeepAlive/환경변수는 건드리지 않았다.

69/70문서와 해당 시안·증거에 남은 1.24.1 표시는 당시 실행 기준으로 유지한다. 새 제품 기준은 이 문서의 1.24.3/DB19이며, 과거 통과 근거를 최신 실행처럼 고쳐 쓰지 않는다. 이번 검증은 별도 evidence에 저장한다.

## 전체 검사에서 확인한 V2 도구 설정 정리

main 병합 후 전체 lint에서 기존 V2 PoC의 Node/browser 전역 선언 누락 등이 나타났다. 제품 코드와 별도로 최소 정리했다.

- `eslint.config.js`: Node PoC·브라우저 시안/Playwright 검증기의 실행 환경을 선언하고 명시적 CommonJS 검증기에서만 require를 허용한다. 제품 src의 네트워크 금지 규칙은 유지한다.
- 미사용 테스트 import 제거, 이미지 필드를 제외하는 비교 코드에서 불필요한 binding 제거. 빈 catch에는 고정 오류/정리 지속 목적을 설명한다.
- Storage 실기 실행기의 finally 내부 throw는 같은 cleanup try/catch에서 잡혀 밖으로 나오지 않는다. 이 한 줄에만 근거를 적고 no-unsafe-finally 오탐을 예외 처리했다. 실제 서버 요청/정리 로직은 바꾸지 않았다.
- Prettier는 JSON.stringify로 생성한 manifest 두 파일만 명시적으로 제외한다. 검토된 원본 bytes/hash를 유지하며 생성 산출물을 임의로 재포맷하지 않는다. PoC 전체를 lint/format에서 제외하지 않는다.

이 정리는 V2 브랜치에만 추가하며 main의 앱/UI 동작을 재수정하지 않는다. 실제 Cloud 실기 실행기는 재실행하지 않았고 기존 서버 통과 결과를 새 시험으로 합산하지 않는다.

## 검증

| 검사 | 결과 |
|---|---|
| npm run build | 통과: TypeScript + Vite |
| npm test | 59개 파일 / 532개 테스트 통과 |
| npm run lint / format:check | 통과 |
| 릴리스 노트·가이드·Feature List check | 통과: 1.24.3 / 가이드 15장면 / 기능 255항목 |
| V2 registry/runtime/이관/사본/DB18·19 회귀 | 235개 통과 |
| Chromium hotfix 1.24.2/1.24.3, u3, workspace-integrity | 26개 통과 |
| 티저 사이트 Chromium smoke | 1440/390px, 푸터 단일화·모션 버튼 제거·reduced-motion 전환·가로 넘침 없음, JS 오류 0 |

Vite의 기존 chunk 크기/동적 import·public 라이선스 import 관련 안내는 남아 있지만 빌드와 대상 E2E는 통과했다. Windows/macOS 설치판·WebKit·native Rust 검사는 이번 범위가 아니다. 이전 A안 9개 배치/실제 DEV/PG 검사를 이번에 재실행한 것으로 표시하지 않는다.

[집계·소스 hash](evidence/main-1.24.3-sync-pass.json) · [V2 회귀](evidence/main-1.24.3-sync-v2.txt) · [단위 테스트](evidence/main-1.24.3-sync-unit.txt) · [E2E](evidence/main-1.24.3-sync-e2e.txt) · [사이트](evidence/main-1.24.3-sync-site.json)

## 다음 단계

V2 기능 작업은 70문서의 지점에서 이어간다. 우선 **제품용 온라인 캐시 형식·활성화 검증 어댑터**를 구현/검증하고, native profile/config/설치·업데이트 격리, OS 보안 저장소/OTP, 기존 appController 단일 경계 재사용과 A안 제품 UI 연결을 순서대로 진행한다. 온라인 설치 식별 정책은 여전히 별도 미확정이며, 현재 PoC 증표로 제품 활성화/배포하지 않는다.
