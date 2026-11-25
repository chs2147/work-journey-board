# 보안 점검 요약 — 2026-11-25 (security-audit-1126)

> Cloudflare `security-audit` 스킬 전체 점검(standard) 결과 요약입니다. 앱 코드는 바꾸지 않았고 결과만 기록했습니다. 전체 기록(`findings.json`·`coverage-ledger.json`·재현 자료)은 저장소 밖 점검 폴더에 있습니다. 확정 2건·실기 확인 필요 3건의 수정은 별도 개선 브랜치에서 진행합니다.


## 1. 점검 범위와 방식
- 점검 기준: 커밋 `4353022`(main 1.53.1 Open Beta와 같은 내용), 점검 브랜치 `security-audit-1126`, 작업 트리 변경 없음.
- 방법: Cloudflare `security-audit` 스킬(고정 커밋 `c1c8a8c`) 전체 점검, 프로필 **standard**.
- 예산: 에이전트 호출 50회 한도 중 **34회** 사용.
  - 정찰 4회
  - 점검 15회(1차 10 + 2차 4 + 3차 1)
  - 누락 검토 5회
  - 후보 검증 5회
  - 최종 기록 검증 5회
- 실행 원칙: 소스 읽기와 로컬 샌드박스 실행만 했습니다.
  - 샌드박스 조건: `bwrap --unshare-all --clearenv`, 읽기 전용 루트, scratch에만 쓰기, prlimit, timeout.
  - 배포된 서버(Supabase·게이트웨이)·GitHub·외부 호스트에는 요청을 한 건도 보내지 않았습니다.
  - 실제 일지나 실제 계정은 쓰지 않았고, 가상 데이터만 썼습니다.
- 이전 점검: 없음(첫 점검)이라 이전 기록을 가져온 것은 없습니다.
- 커버리지에 대해: 이 한 번의 점검이 저장소 전체를 다 봤다는 뜻은 아닙니다.
- 소스로 볼 수 없어 범위에서 제외한 것:
  - 배포된 Supabase 프로젝트의 실제 권한(GRANT·RLS) 상태
  - Windows·macOS 실행 환경 동작(ShellExecute, SMB/NTLM, WebView2, 키체인)
  - 코드 서명 상태
- 이 항목들은 "실기 확인 필요"로 넘겼습니다.

## 2. 보안 상태 요약
- 핵심 경계는 대체로 단단합니다.
  - 웹뷰 XSS 방어(CSP `script-src 'self'`, Tiptap 링크 http(s)만 허용, Markdown 가져오기는 글자만)
  - 게이트웨이 인증(ES256 고정, 세션 활성 확인, 기기 결속)
  - 다른 계정 데이터 분리(SECURITY DEFINER 함수마다 소유자 확인)
  - 업데이트 경로(같은 저장소·판 비교·SHA256)
  - CI 권한(PR은 읽기 전용)
  - 로그인 토큰 보관소
- 약점은 한 가지 성격에 몰려 있습니다. **일지 파일이나 동기화 서버에서 온 값을 "이 PC에서 사용자가 직접 고른 값"처럼 믿는 것**입니다.
- 이 때문에 아래가 생깁니다.
  - 확정 2건: 둘 다 심각도 낮음
  - 실기 확인 필요 3건

## 3. 확정 결과
| 심각도 | 제목 | 넘는 경계 | 관찰 결과(한 줄) |
|---|---|---|---|
| 낮음 | 업무 보드 Markdown 내보내기의 이미지 파일 이름 경로 이탈 | 일지 내용 → 사용자가 고른 내보내기 폴더 밖 파일 쓰기 | 자산 ID `..\..\..\Documents\report` → 고른 폴더 밖 `report.png`가 공격자 바이트로 덮어써짐(POSIX 가상 파일로 재현). Rust 검사는 `Ok` |
| 낮음 | 온라인 동기화 받기에 보내기 쪽 행 규칙이 없음 | 같은 소유자의 다른 기기(변조 클라이언트) → 이 기기 전용 설정·Cabinet 경로 | 다른 기기가 보낸 원본 행으로 이 기기 Cabinet 폴더가 `\\v03-dummy-host\share`로 바뀌고, 백업 보관 설정이 14일 → 1개로 바뀜 |

### 3-1. 업무 보드 Markdown 내보내기 이미지 경로 이탈
지문: `export-markdown-image-name-traversal/cabiExport.writeCabiDocument+files.export_path_allowed`

- **위치**:
  - `src/domain/note.ts:433`: 이미지 asset이 비어 있지 않은 문자열이기만 하면 통과합니다.
  - `src/ui/cabinet/cabiExport.ts:53-55`: 파일 이름을 `${id}.${ext}`로 만들고 `exportPathProblem`을 거치지 않습니다.
  - `src/platform/tauri.ts:40`: `join`이 `..`를 그대로 둡니다.
  - `src-tauri/src/files.rs:448-463`: 확장자와 바로 위 폴더 이름(문자열)만 비교합니다.
  - `src-tauri/src/files.rs:493`: 임시 파일을 만든 뒤 이름을 바꿔 씁니다.
- **낮은 신뢰 주체**: 공유·동기화 폴더 등에서 받은 일지 파일을 만든 사람.
- **재현(로컬)**:
  - 가상 일지에 다음을 넣었습니다.
    - `cabi_board.doc`: 이미지 상자 asset `..\..\..\Documents\report`
    - 같은 ID의 `cabi_asset`: `image/png`
  - 실제 저장소 코드로 `writeCabiDocument('markdown')`을 돌렸습니다.
  - 결과:
    - 쓰기 경로가 `…\exports\Board_images\..\..\..\Documents\report.png`로 나왔습니다.
    - 원문 그대로 옮긴 Rust `export_path_allowed_all`이 이 경로와 `..\..\backups\x.png` 모두에 `Ok`를 돌려줬습니다.
    - POSIX 가상 폴더에서 `ORIGINAL`이 `ATTACKER`로 바뀌었습니다.
- **조건**: 피해자가 그 일지의 업무 보드를 열고 Markdown으로 내보내야 합니다.
  - 고른 폴더 밖에 쓸 수 있는 확장자: `.png`·`.webp`
  - 다른 `*_images` 폴더에 쓸 수 있는 확장자: `.jpg`·`.gif`
- **영향**: 사용자가 쓸 수 있는 이미지 파일을 몰래 만들거나 덮어씁니다. 공간 `backups` 폴더 안도 포함됩니다. 실행 파일 확장자는 막혀 있어 코드 실행은 없습니다.
- **우선순위 이유**: 일지를 받고 내보내기까지 해야 해서 가능성은 낮습니다. 파일 무결성 피해라서 영향은 중간입니다. 종합 낮음입니다.
- **가장 작은 수정**:
  - 저장된 ID로 파일 이름을 만들지 말고, `image-<번호>.<확장자>`로 새로 붙입니다.
  - mime은 고정 목록으로 확장자를 정합니다.
  - 이미지 경로마다 `exportPathProblem(...,'markdownImage')`를 거칩니다.
  - Rust `export_path_allowed`에서 `.`·`..`·빈 경로 조각을 거부합니다.
  - 회귀 시험을 넣습니다(TS·`cargo test`).
- 같은 뿌리 변형: 주간 메모 Markdown 내보내기(`markdownExport.ts:144`)도 상자 ID를 파일 이름으로 씁니다.
  - 그래서 다른 `*_images` 폴더로 들어가는 것은 막히지 않습니다.
  - 범위는 업무 보드 쪽보다 좁습니다.

### 3-2. 동기화 받기에 행 규칙 없음
지문: `src/preview/spaceSync.ts:pull-apply-skips-row-contract`

- **위치**:
  - `poc/v2-migration/postgres/019-workspace-sync.sql:184`: push 때 행 모양을 검사하지 않습니다.
  - `src/preview/spaceSync.ts:526`: 받은 행을 그대로 반영합니다(`toLocal`, `:208`은 설정을 `{...mine, ...theirs}`로 합침, `:216`).
  - `poc/v2-migration/workspace-restore-core.mjs:19`: `targetState`가 있을 때만 폴더 경로를 바꿉니다.
  - `src/ui/cabinet/cabinetStore.ts:206`: 받은 폴더 경로를 `cabinet_set_roots`에 넘깁니다.
- **낮은 신뢰 주체**: 같은 소유자 공간에 올릴 수 있는 다른 기기·세션, 곧 변조된 클라이언트나 탈취된 세션.
- **재현(로컬)**:
  - 저장소에 있는 가짜 동기화 서버(019 규칙을 그대로 따름)를 썼습니다.
  - 기기 B가 `mapRow`를 거치지 않은 원본 행을 올렸습니다. 기기 A가 받았습니다.
  - 결과:
    - A의 `cabinet_item.target`이 `\\v03-dummy-host\share`로 바뀌었습니다.
    - A의 `settings.backup`이 `dailyKeep 14, days 30`에서 `dailyKeep 2, monthlyKeep 0, count`로 바뀌었습니다.
- **영향**: "폴더 경로·기기 설정은 기기마다 따로"라는 경계가 깨집니다.
  - Cabinet 허용 루트가 넓어집니다.
  - 백업 보관이 몰래 약해집니다.
  - 다른 계정은 서버의 소유자 검사로 막힙니다.
- **우선순위 이유**: 정식 클라이언트는 항상 `mapRow`를 거치므로 가능성은 낮습니다. 영향은 중간입니다. 종합 낮음입니다.
- **가장 작은 수정**:
  - 받기·충돌 해결 때 보내기와 같은 규칙을 적용합니다.
    - 열·형식을 확인합니다.
    - 폴더 항목은 `target:null`과 `targetState:"device-local-unbound"`일 때만 받습니다.
    - 설정은 `projectSettings`로 거른 동기화 키만 합칩니다.
  - 위반하는 행은 건너뛰거나 충돌로 처리하고, 커서는 막히지 않게 합니다.
  - 서버 019/022 push에도 007의 `MIGRATION_LOCAL_PATH` 같은 검사를 넣습니다.
  - `spaceSync.test.ts`에 회귀 시험을 넣습니다.

## 4. 실기 확인 필요(심각도 없음, 확정 아님)
| 제목 | 소스 경로 | 막힌 사실 | 로컬 다음 단계 | 소유자 확인 |
|---|---|---|---|---|
| Cabinet "탐색기에서 열기"가 일지가 지정한 실행 파일을 확인 없이 염 | `cabinetStore.ts:198/206/573` → `CabinetPanel.tsx:591` → `cabinet.rs:35/129` | Windows ShellExecute·macOS에서 `.exe/.bat/.lnk/.command`를 바로 실행하는지, MOTW·SmartScreen·Gatekeeper가 끼어드는지 | 일회용 Windows VM DEV판, 가상 `dummy.bat` 폴더 항목 → ⋯ → 탐색기에서 열기 → `ran.txt` 생기는지 | 남이 쓸 수 있는 공유·동기화 폴더의 일지가 지원 대상인지 |
| Cabinet 열 때 일지의 UNC 폴더 경로를 자동 조회 | `cabinetStore.ts:198/605` → `CabinetPanel.tsx:121/124` → `files.rs:101` | `fs::metadata`가 `\\host\share`로 SMB·NTLM 인증을 보내는지(445 차단·NTLM 제한 정책 영향) | 격리 VM 두 대, 기록만 하는 SMB 수신기, 클릭 없이 Cabinet 열기·창 포커스 바꾸기 | 공유 일지 지원 여부와 회사 PC의 밖으로 나가는 SMB 정책 |
| 일지에 저장된 `ui.lastExportDir`(UNC)를 내보내기 때 조회·대화상자 시작 폴더로 씀 | `repository.ts:632` → `settings.ts:199` → `exportStore.ts:103` 외 5곳 → `tauri.ts:323` → `files.rs:101` | 같은 SMB·NTLM 동작(대화상자 포함) | `mergeSettings` 단위 회귀(지금은 UNC 문자열이 그대로 남음) + Windows VM에서 내보내기 한 번 누르기 | 같은 결정 |

세 건 모두 "일지가 주는 경로를 이 PC 경로처럼 믿는 것"이 공통 원인입니다. 경로가 로컬 절대 경로인지 확인하고, UNC·`\\?\`는 거부하고, Cabinet 루트는 이 PC 설정에 등록한 폴더만 쓰게 하면 함께 막힙니다.

## 5. 보강 권고(취약점 아님)
- **네이티브 명령 접근 목록**: `build.rs`에 앱 명령 ACL이 없어, 보조 창(Cabinet·노트·폴더·스플래시)도 `db_batch`·`config_write` 등 60여 개 명령을 모두 부를 수 있습니다. 창마다 필요한 명령만 허용하면, 나중에 렌더러 XSS가 생겨도 권한이 커지지 않습니다.
- **창 이동 방어**: `on_navigation` 같은 이동 허용 목록이 없습니다. 지금은 편집기마다 클릭을 막는 것에만 기댑니다.
- **업데이트**:
  - `SHA256SUMS.txt`가 없거나 받기에 실패하면 검증 없이 설치를 진행합니다. 실패로 막아야 합니다.
  - 코드 서명이 없습니다(NSIS 서명 없음, 맥 애드혹). 내장 공개키 서명을 검토할 만합니다.
  - `url_allowed`가 문자열 앞부분만 비교합니다.
- **CI**:
  - `build-desktop.yml`·`m0-windows-build.yml`은 워크플로 전체에 `contents: write`를 줍니다. 릴리스 작업에만 주고, checkout에 `persist-credentials: false`를 넣는 게 좋습니다.
  - 외부 액션을 SHA로 고정하고, `github.ref`를 env를 거쳐 넘기는 것도 권합니다.
- **로컬 파일**:
  - `export_write`의 임시 파일이 `File::create`라서 미리 심어 둔 심볼릭 링크를 따라갑니다.
  - backups 제외 검사가 바로 위 폴더 문자열만 비교합니다.
  - `dev_guard`는 상위 두 단계까지만 봅니다.
- **로그인**:
  - 로그아웃할 때 메모리에 액세스 토큰이 없으면 서버 세션을 끊지 않습니다.
  - 계정을 바꿔도 이전 refresh 토큰이 보관소에 남습니다.
- **게이트웨이**:
  - JWKS를 무기한 캐시합니다(키를 교체할 때 가용성 문제).
  - `wjb_ops`·`wjb_life` 스키마에서 anon·authenticated 권한을 명시적으로 회수하지 않습니다(함수·표 권한은 회수돼 있음).
- **설정 병합**: `deepMerge`가 `k in base`를 쓰므로 `__proto__`·`constructor`를 건너뛰는 것이 좋습니다. 지금은 `structuredClone` 덕분에 안전합니다.
- **가져오기**: 가져오기 마법사 상태가 `detachAll`에 등록돼 있지 않아, 공간을 바꾼 뒤 이전 계획이 새 일지에 적용될 수 있습니다(CLAUDE.md 4-7, 같은 사용자 무결성 문제).
- **기타**:
  - `.gitignore`에 `.env`·`*.pem`·`*.key`가 없습니다.
  - 의존성 CVE 검사(`npm audit`·`cargo audit`)를 CI에 넣는 게 좋습니다. 이번에는 오프라인이라 하지 못했습니다.
  - 드롭 브리지에서 WebMessage `Source`를 확인하는 것이 좋습니다.
  - 바로 가기의 UNC 대상을 거부하는 것이 좋습니다.

### 좋은 패턴
- 링크 열기를 TS와 Rust 두 번 검사합니다.
- 백업 삭제·이름 변경 가드가 두 곳에 있습니다.
- 복원할 때 원본을 보존합니다.
- 게이트웨이가 Origin 헤더를 거부하고, 고정된 오류 코드만 보냅니다.
- 다른 기기 자산을 해시와 크기로 검증합니다.
- DEV·정식 판을 프로필로 분리합니다.
- 보관소 키를 범위로 나눕니다.

## 6. 커버리지 요약
- 점검 단위 15개
  - 완료(covered) 11
  - 후보(candidate) 4
  - 막힘(blocked) 0, 미룸(deferred) 0
- 웨이브 3번과 누락 검토 5번을 돌렸습니다.
  - 1차 뒤: 4개 영역 추가
  - 2차 뒤: 없음
  - 최종 점검: 1개 영역 추가
  - 3차 뒤와 최종 점검: 없음
- 마지막 최종 점검에서 추가할 영역이 없어 커버리지를 닫았습니다.
- 선택하지 않은 영역과 이유:
  - AI·LLM: 해당 구성 요소가 없습니다.
  - 클라우드 IaC: 저장소에 없습니다.
  - 자원 고갈: 사용자 한 명의 로컬 앱입니다.
- 메모리 안전은 보관소 FFI·드롭 브리지 COM 단위에서 따로 봤습니다.
- 반박된(rejected) 기록: 0건
- 모든 후보가 독립 검증 2단계(후보 검증 → 최종 기록 검증)를 통과했습니다.
