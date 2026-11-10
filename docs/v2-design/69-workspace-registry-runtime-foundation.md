# 69. A안 확정·워크스페이스 목록과 실행 분기 공통 기반

2026-11-10 UTC · v2-design · 제품1.24.1/DB19 유지 · 독립 구현/검증

## 이번 진행

68문서의 수정 시안/운영 규칙을 **6b07b75**로 커밋·푸시했다. 후속 작업 중 사용자가 UI 기본 배치를 **A안 · 기존 설정 확장**으로 선택했다. A/B/C 재선택은 필요하지 않다. 별도 앱/설치 식별 정책은 배치 선택과 다른 항목이며 기존 후보를 확정한 것으로 간주하지 않는다.

A안에 연결할 공통 기반으로 별도 SQLite registry, 브라우저에서 재사용 가능한 순수 유형/상태 projection, trusted adapter 기반 실행 분기를 구현했다. 아직 src/Tauri 제품에 연결하지 않았으며 사용자 실제 파일/Cloud/설정/릴리스는 변경하지 않았다.

## 목록 모델과 원본 보존

`poc/v2-runtime/workspace-registry.mjs`는 자체 application_id/user_version의 별도 파일만 연다. 기존 DB/config/journal·symlink/hardlink를 쓰기용 registry로 재사용하지 않는다. 보호할 기존 공간/설정 루트를 명시해야 하며 그 안에 registry/온라인 캐시를 만들지 않는다. 테스트용 `.v2-poc-only` guard도 유지한다.

`importOffline`에는 사용자가 명시적으로 고른 기존 config의 workspace 항목만 전달한다. 이 모듈이 config를 자동 탐색하거나 기존 파일을 다시 저장하지 않는다. kind가 없던 항목은 offline_only로 등록하고 원래 name/dir/icon/color/시각/보조백업 정보는 registry의 로컬 metadata로 보존한다. 알 수 없는 필드·credential 같은 값은 조용히 복사하지 않고 거절한다. DB18/19 원본과 기존 config/폴더 항목 목록이 변하지 않는 것을 검사했다.

entry_id는 **새 목록의 참조 식별자**이며 기존 DB/설정에 UUID를 삽입한 것이 아니다. 기존 공간은 기존 식별/파일 구조를 유지한다. 신규 온라인 공간은 별도의 cloud_workspace_id·owner_id와 registry 항목을 갖는다. SQL trigger로 유형·원본 경로·소유자·온라인ID·캐시 위치를 제자리 UPDATE하지 못하게 한다.

| 명령 | 의미/제약 |
|---|---|
| importOffline | 기존 항목을 offline_only로 보존. 명시적 online 값을 받아 원본을 전환하지 않음 |
| createOnlineFromOffline | 오프라인 원본 항목 필수. 새 온라인ID/목록 항목 생성, 원본 유지 |
| createEmptyOnline | 원본 없이 온라인 항목 생성. source 참조 전달 금지 |
| connectExistingOnline | 이미 있는 cloud ID를 같은 계정으로 재사용. 이름으로 병합하지 않음 |

위 명령은 **로컬 registry 항목의 준비**이며 이 호출만으로 실제 서버 공간을 만들거나 제품으로 활성화하지 않는다. 원격 생성/검증은 별도 이관·생성 서비스의 책임이다. UI의 A안 계정/목록/생성 흐름에서 이 구분을 유지한다.

## 유형과 전송 상태

`workspace-kind.mjs`는 파일/인증/네트워크 import가 없는 순수 함수다. UI가 registry 종류를 표시할 때 SQLite 모듈을 번들하지 않아도 된다.

- offline_only는 항상 ‘오프라인 전용’/디스크 아이콘이다. 이 분기에서는 network/auth/pending 입력조차 읽지 않는다.
- online은 연결 끊김·인증 만료에도 ‘온라인’/구름 아이콘을 유지한다.
- ‘이 PC에 저장됨’과 ‘온라인 반영됨’은 별개다. 전송 대기0만으로 성공하지 않으며 현재 서버 ack와 로컬 저장 완료가 있어야 온라인 반영됨으로 표시한다.
- 표시 함수의 ack는 실제 sync 어댑터가 검증해 전달할 상태 계약이다. 함수가 서버 전송을 수행/검증하는 것은 아니다.

## 실행 분기와 늦은 응답

`openRegisteredWorkspace`는 반드시 native/application의 `isCurrent` 요청 guard를 요구한다. offline 항목은 offline adapter만 호출하며 cloud/activation getter를 평가하지 않는다. 온라인은 저장된 owner/cloud ID를 사용하고 다른 계정이면 서버 초기화 전에 거절한다. 온라인 오류·계정 오류·미지원 증표에서 offline adapter로 fallback하지 않는다.

서버 검증을 기다리는 동안 사용자가 다른 공간/계정으로 전환하면 늦은 응답으로 driver를 열지 않는다. 이미 생성했지만 아직 활성화하지 않은 handle이 뒤늦게 도착하면 닫고 반환을 거절한다. native factory는 driver 생성까지만 하며 화면 활성화는 이 분기 결과가 유효할 때 appController에서 수행해야 한다.

온라인 캐시 경로는 registry 루트/online-cache/ownerUUID/cloudWorkspaceUUID로 만든다. 임의 사용자 경로를 받지 않으며 실제 열기 직전에 realpath/보호 루트/등록된 원본 경로를 다시 확인한다. 나중에 symlink가 원본/Classic 설정으로 향하도록 바뀌어도 거절한다.

오프라인 원본 경로도 열기 직전에 realpath가 등록 시점과 일치하는지 다시 확인한다. 원본 경로가 다른 저장소를 가리키도록 바뀌면 열지 않는다. 실제 DB header/schema family 검사까지 구현한 것으로 해석하지 않는다.

현재 DEV의 `poc-verified`는 제품 활성화로 받아들이지 않는다. `connected-product-v1`/workspace-runtime capability 이름은 **미래 native cache 검증 callback의 예약 계약**이며 실제 제품 저장소 구현이 아니다. 실제 cache schema/header/manifest·계정 인증·지원 capability를 검사하는 native 어댑터가 완성되기 전 현재 PoC 사본을 제품으로 열지 않는다. 테스트의 verified 값은 명시적 가상 adapter다.

## 검증 범위

새 registry/상태/분기 테스트 29개와 기존 격리/이관/사본/DB18·19 회귀 177개, 총 **206개가 통과**했다(실패 0). 내용은 원본/config/hash 보존, 재열기/식별자 유지, 생성과 받기 구분, 동일 이름 비병합, 유형 UPDATE 거절, 기존 DB 오인 방지, alias/경로 보호, offline의 cloud 초기화0, 잘못된 계정/PoC 증표/서버 장애, late activation 차단/handle 정리다.

[실행 로그](evidence/workspace-registry-regression.txt) · [집계·소스 hash](evidence/workspace-registry-pass.json). 실제 Linux 임시 SQLite 파일로 검사했으며 Windows/macOS 네이티브 설치·파일 락·junction/Keychain·업데이트 피드 실기를 대체하지 않는다. 이번 변경으로 서버 SQL/Storage 기능을 바꾸지 않아 이전 PG/DEV 시험을 재실행한 것으로 표시하지 않는다.

## 다음 작업

**A안은 확정**이다. 다음은 이 인터페이스를 바탕으로 native 설정/드라이버 경계와 A안 화면 상태를 연결한다. 실제 native 프로필·OS 보안 저장소·제품용 cache 형식/완료 증표·OTP 운영 관문을 통과해야 실제 온라인 공간을 열 수 있다. 기존 원본에는 온라인용 schema 변경을 적용하지 않는다. 7번 기기 간 동기화/8번 전면 다국어는 별도 후속 범위다.
