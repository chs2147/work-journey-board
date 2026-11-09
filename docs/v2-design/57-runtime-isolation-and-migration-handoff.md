# 57. 로컬/온라인 실행 경계·경로 보호·이관 완료 연결 계약

2026-11-10 KST · v2-design · 독립 PoC. 제품/설치/기존 설정/사용자 DB는 변경하지 않았다.

## 이번 단계의 결과

56문서의 로컬 영구 지원 철칙을 실행 경계로 옮겼다. [isolation.mjs](../../poc/v2-runtime/isolation.mjs)에 별도 앱 식별/설정/런타임/업데이트/인증정보/IPC/단일 실행 namespace의 후보와 충돌 거절, 로컬/온라인 저장 어댑터 분기, 온라인 사본의 서버 완료 증표 검증 연결점을 구현했다. 실제 제품이 이 모듈을 호출하는 상태는 아니다.

이전 c2af39c는 작업 시작 시 이미 원격과 같았으며 재푸시 결과 Everything up-to-date였다. 빈 커밋을 만들지 않고 후속 작업을 진행했다.

## 실제 소스에서 확인한 격리 누락 지점

| 실제 근거 | 관측 | 필요한 분리 |
|---|---|---|
|src-tauri/tauri.conf.json|identifier=com.chs2147.workjourneyboard, productName=Work Journey Board|온라인 후보의 앱/설치 식별자·표시 이름 별도 |
|src-tauri/src/files.rs config_path|CONFIG_DIR=WorkJourneyBoard를 local_data_dir에 직접 붙임|앱 identifier만 바꿔도 config.json이 자동 분리되지 않음 |
|src-tauri/src/update.rs|기존 저장소 releases?per_page=10 고정, 사전 릴리스 포함|온라인 RC도 기존 저장소 피드에 게시 금지 |
|update.rs updates_dir|app_local_data_dir/updates|실제 앱 식별자별 OS 디렉터리/권한 검증 필요 |
|lib.rs single-instance 등록|플러그인으로 단일 실행 처리|온라인 별도 식별자·IPC/인스턴스 충돌 실기 검증 필요 |

현재 제품의 updater는 새 profile manifest를 해석하지 않는다. 새 PoC에서 profile을 검사한다고 이미 설치된 로컬판의 V2 자동 교체가 차단되는 것은 아니다. **기존 릴리스 피드에 온라인 설치물을 올리지 않는 배포 경계**가 필수다.

## 후보 실행 프로필

| 항목 | 기존 local-classic 관측 | connected-preview 후보 |
|---|---|---|
|App ID|com.chs2147.workjourneyboard|com.chs2147.workjourneyboard.connected.preview |
|설정 폴더|WorkJourneyBoard|WorkJourneyBoardConnectedPreview |
|이름|Work Journey Board|Work Journey Board Connected Preview |
|인증정보/IPC/인스턴스|기존 앱 namespace|후보 App ID 기준 별도 namespace |
|기존 파일 연결|현행 유지|초기 등록 안 함 |
|업데이트 피드|chs2147/work-journey-board|미정, updater/publication 비활성 |

후보 이름/식별자는 PoC 값이고 제품 브랜딩/네이티브 등록/설치 경로 확정이 아니다. 신규 GitHub 저장소/릴리스/서명·권한 등록은 하지 않았다. 명시적 프로필·플랫폼·신뢰된 절대 base path만 받으며 env/기존 config 자동 fallback은 없다. credential namespace 문자열 분리는 실제 OS 자격증명 저장 구현을 의미하지 않는다.

별도 온라인 앱이 로컬 공간을 지원할 때도 local mode는 기존 저장 계약의 local adapter만 호출한다. cloud factory/credential 조회/온라인 초기화는 하지 않는다. 온라인 오류를 원본 local adapter로 fallback하여 잘못된 DB에 쓰는 경로도 금지한다. 기존 로컬판의 승인된 GitHub 새 판 확인/OS 링크 열기 예외는 그대로다.

## 원본 공간의 디렉터리도 보호

56문서의 추출기는 DB 파일 hash/내용을 보존했으나, 시험 배치만으로는 원본 **폴더 안에** 온라인 사본을 만드는 것을 거절하지 못했다. 이를 보완해 actual createConnectedCopy 호출에서 원본 DB의 부모와 목적지 부모를 realpath로 확인한 뒤 다음을 거절한다.

- 동일한 위치, 원본 하위의 새 온라인 폴더, 원본을 포함하는 상위 목적지.
- `..` 정규화로 겹치는 경로, Windows 대소문자/끝 점·공백·device/alternate-stream 경로, macOS 대소문자/Unicode 정규화 alias.
- symlink 목적지/원본과 기존 목적지 덮어쓰기.

Linux 실제 가상 파일 시험에서는 원본 DB hash뿐 아니라 원본 폴더의 항목 목록도 그대로임을 확인했다. Windows/macOS 경로 문자열 시험은 Linux에서 수행했으며 실제 volume의 junction/short-name/Unicode·락·ACL·OS alias 검증은 해당 OS에서 남아 있다. 실제 제품 파일 접근은 Platform/Rust의 canonical path·파일 소유권/락 가드를 통해야 한다.

## 추출 완료와 온라인 활성화 사이 연결

```text
원본 로컬: 기존 DB/이미지로 계속 사용
새 온라인 사본: 추출 검증 → Blob/metadata 전송 → 전체 검증 → 서버 완료 증표 → 연결 열기
```

openWorkspaceRuntime의 connected 분기는 legacy-db18을 거절하고 connected-metadata만 허용한다. 신뢰된 서버 adapter verifyMigration이 다음 완료 정보를 조회해야 connected factory를 호출한다.

```json
{
  "status": "verified",
  "workspaceId": "00000000-0000-4000-8000-000000000001",
  "manifestHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "generation": "1"
}
```

위 값은 설명용 fixture다. 기대한 새 공간 ID/manifest hash와 정확히 일치해야 하고 generation은 양의 정수 문자열이어야 한다. local READY 파일·cloudUploaded=false·UI의 true boolean·다른 공간/다른 manifest는 완료 근거가 아니다. 증표 조회 실패 시 원본 DB로 우회하지 않는다.

**실제 서버 이관 증표 RPC는 아직 없다.** 이번 구현은 신뢰된 서버 조회 callback의 계약/분기 검증이며 임의 클라이언트가 증표 JSON을 보내 활성화할 API가 아니다. 후속 서버는 문서/소유권/참조/Blob hash·bytes·이미지 본문0건·미확정 업로드를 검증한 뒤 같은 manifest에 대해서만 증표를 발급해야 한다. receipt 서명/인증·세션/공간 scope 검증은 기존 gateway의 trusted transport 계약과 연결한다.

## 검증과 미완료 범위

신규 격리29개, 사본 추출23개(이전22+원본 폴더 중첩 거절1), 기존 DB18 회귀19개로 **71개 통과**. 로그/hash/소스 hash는 [성공 증거](evidence/runtime-isolation-pass.json)에 보존한다. 기존41개 증거는 당시 체크포인트로 남긴다.

```sh
node poc/v2-runtime/isolation.test.mjs
node poc/v2-assets/connected-copy.test.mjs
node poc/v2-sync/db18.test.mjs
```

A06은 계약/PoC/사본 경로 가드까지 진척됐고 실제 앱/설치/업데이트/인증정보 분리 완료는 아니다. native 변경은 제품 이행 단계에서 별도 설정/빌드/Win/macOS 검증이 필요하다. 이번에 src/src-tauri/package/워크플로/Cloud DB/환경/유료 서비스는 바꾸지 않았고 실제 사용자 파일은 사용하지 않았다.

## 다음 단계

1. 이관 작업 ID/새 공간/manifest·진행 상태를 이미지 본문 없이 영속화하고 업로드 재개·취소·실패 후 재조회 정책을 구현한다. 이관 작업의 metadata 기록과 온라인 공간 활성화를 분리한다.
2. 현재 추출 포맷의 전체 보존 행을 서버 도메인 명령으로 매핑하고 기기 경로/설정 제외·이미지 참조/본문0건 검증을 연결한다. 현재 파일 구조를 그대로 서버에 업로드하지 않는다.
3. 이미지 전송은 Supabase private Storage를 이용한다. 현 gateway64KiB 범위를 넘는 제품용 자산은 한도/schema 검토 후 전진 변경으로 다룬다. 기존 설치 묶음을 재실행하거나 한도만 임의 확대하지 않는다.
4. 실제 이관 완료 증표와 native profile 설정/설치·업데이트 격리, Win/macOS 원본 보존 회귀를 연결한 뒤 제품의 ‘온라인 사본 만들기’를 활성화한다.
