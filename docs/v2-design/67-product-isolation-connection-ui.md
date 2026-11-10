# 67. 제품 실행 격리·온라인 연결 UI 상세 설계와 3개 시안

2026-11-10 UTC · v2-design · 제품 기준1.24.1/DB19 · **검토안, 제품 구현 전**

**최신 사용자 기준:** [68. 기존 오프라인 공간 유지·신규 온라인 운영·유형 표시](68-workspace-type-operating-rules.md)가 용어/운영 모델에 우선한다. ‘참조’는 원본을 다루는 내부 경계이며 기존 워크스페이스를 폴더나 백업본으로 격하하는 개념이 아니다. 별도 Preview 실행 방식은 여전히 미확정 제안이다.

현재 커밋 cfdeae4는 원격에 반영된 상태였다. 재푸시 결과도 동일해 빈 커밋은 만들지 않았다. 이번 작업은 6번의 상세 설계/상호작용 시안/검토 자료다. 앱·Tauri·기존 설정·업데이트 피드·DEV 데이터는 변경하지 않는다. 아래 선택은 아직 사용자 확정이 아니다.

**직접 체험:** [3안 비교·24개 상태·3개 테마](mockups/step6/index.html) · [화면별 안내](mockups/step6/README.md). 모든 계정·기기·수치는 가상이다. HTML에는 API 호출·저장·로그인이 없다. 같은 저장소의 로컬 폰트만 참조한다.

## 1. 실행 방식의 추천

초기 제품 검증은 기존 **Local Classic**과 별도 **Connected Preview** 실행 프로필을 사용한다. 공통 도메인/컴포넌트를 재사용하되 실행 식별자·데이터·설정·인증·업데이트 경로는 분리한다. 이는 [57문서](57-runtime-isolation-and-migration-handoff.md)의 후보를 구체화한 제안이다. 최종 앱 이름/배포 채널은 아직 미확정이다.

- 기존 Local Classic은 지금처럼 로컬 일지를 운영한다. 계정/클라우드 초기화 없이 실행하며 기존 DB·이미지·백업 계약을 유지한다. 사용자가 포기하기 전 유지보수 종료나 자동 전환을 하지 않는다.
- Connected Preview는 **사용자가 OS 폴더 선택으로 추가한 원본 참조만** 보관한다. 기존 Classic 설정/최근 폴더를 자동 탐색·가져오기하지 않는다. 시안의 로컬 목록은 명시적으로 추가한 참조다.
- Preview에서 로컬 참조를 누르면 ‘로컬 앱에서 열기’를 제공한다. Preview의 온라인 Repository를 원본에 연결해 쓰지 않는다. Classic이 없으면 위치/설치 안내를 제공하며 임의 실행파일을 요청 데이터로 받지 않는다.
- 이관은 새 UUID/별도 위치의 사본 생성이다. 완료 후 원본과 새 공간은 독립적으로 편집한다. 원본의 이후 편집이 자동으로 새 공간에 합쳐진다고 안내하지 않는다.
- 다른 기기에서 **이미 있는 온라인 공간 받기**는 새 사본 생성과 다르다. cloudWorkspaceId는 유지하고 이 기기의 deviceId/cache만 새로 만든다. 이름이 같은 공간을 자동 연결하지 않는다.

### 네이티브 경계

| 경계 | Local Classic 현행 | Connected Preview 제안 | 검증 조건 |
|---|---|---|---|
| 앱 ID | com.chs2147.workjourneyboard | com.chs2147.workjourneyboard.connected.preview | Windows/macOS 동시 설치·실행 |
| 설정 폴더 | WorkJourneyBoard | WorkJourneyBoardConnectedPreview | files.rs의 상수도 분리. 앱 ID만 교체하지 않음 |
| 공간 목록 | 기존 config.json | Preview 전용 registry | 기존 목록 자동 쓰기/계정정보 삽입 금지 |
| DB family | local SQLite/DB19 | connected-cache의 독립 family/version | 헤더 확인 후 해당 migration만 실행 |
| credential/IPC/instance | 기존 namespace | Preview ID + 계정별 namespace | OS Keychain/Credential Manager 실구현 필요 |
| 업데이트 | 기존 GitHub Releases | 독립 채널 확정 전 꺼짐 | 기존 피드에 Preview 설치 파일 게시 금지 |
| 파일 연결 | 현행 | 초기 미등록 | URI/file association으로 Classic을 가로채지 않음 |
| 백업/진단 | 기존 로컬 정책 | Preview 전용 루트/계정별 작업 | Classic 백업 정리기가 Preview를 지우지 못함 |

설정/캐시/백업 루트는 OS API가 돌려주는 신뢰된 절대 경로를 기준으로 한다. 원본과 같은/상위/하위 경로·symlink/junction·대소문자/Unicode alias·기존 파일 덮어쓰기를 거절한다. 문자열 PoC와 실제 OS 파일 소유권/락 검증을 구분한다.

## 2. UI 배치 시안 3개

모든 안은 같은 격리·원본 보존·검증 계약을 사용한다. 차이는 진입 위치와 정보 밀도다. 제품 기본안은 **A 추천**이다. C의 빠른 진입은 사용량을 확인한 뒤 후속으로 추가할 수 있으나 이번에 혼합안으로 자동 확정하지 않는다.

| 안 | 진입과 구성 | 장점 | 검토할 점 |
|---|---|---|---|
| **A · 설정 확장형** | 기존 ‘설정 > 워크스페이스’ 구조. 계정 카드 + 로컬 참조/온라인 공간 목록 + 중앙4단계 안내 | 기존 UI와 변경이 가장 적고 정보가 안정적 | 이관이 잦다면 설정 진입이 한 단계 필요 |
| **B · 공간 관리 허브** | 별도 공간 관리 화면. 계정·공간 목록·기기·최근 연결 활동 + 넓은 안내창 | 여러 기기와 공간을 한눈에 비교 | 새 관리 화면과 통계 요소가 늘어남 |
| **C · 빠른 연결 패널** | 주간 보드의 공간 메뉴 + 단일 열 오른쪽 패널 | 기록 화면을 떠나지 않는 빠른 접근 | 원본/사본 정보가 세로로 길어짐. 대기 상태 표시가 복잡해질 수 있음 |

| 기본 화면 | 사본 검토 화면 |
|---|---|
| [A 설정 목록](mockups/step6/a-overview.png) | [A 중앙 안내창](mockups/step6/a-review.png) |
| [B 관리 허브](mockups/step6/b-overview.png) | [B 넓은 안내창](mockups/step6/b-review.png) |
| [C 공간 메뉴](mockups/step6/c-overview.png) | [C 측면 패널](mockups/step6/c-review.png) |

카테고리 색은 점/아이콘으로 구분한다. 항목 왼쪽 둥근 색 띠를 새로 도입하지 않는다. 아이콘은 기존 앱과 같은 선형 모노그램이며 hover tooltip/접근성 이름을 갖는다. 새 설명문·상태는 카드 본문의 시작 여백과 정렬한다. 시그니처/라이트/다크를 모두 제공한다.

## 3. 사용자 흐름과 화면별 계약

### 3.1 계정 연결

‘온라인 워크스페이스 만들기’ → 미로그인이라면 이메일 입력 → 인증번호 → 원래 선택한 공간/작업으로 복귀한다. 계정 로그인만으로 공간을 업로드하지 않는다. 이메일은 표시값이고 accountId가 소유권 기준이다. 실제 대상 계정을 사본 검토 화면에서 다시 보여준다.

시안은 기존07문서의 이메일 OTP 제안을 표현한다. **실제66문서 시험은 가상 계정의 비밀번호 로그인**이므로 OTP/SMTP/가입 메일이 제품 검증됐다는 의미가 아니다. 메일 공급/Free 한도/주소 변경·분실 복구는 구현 전에 확정·실증한다. 로그인 변경 시 기존 대기열을 다른 계정으로 이동하지 않는다.

### 3.2 원본 선택과 일관된 사본

사용자가 선택한 로컬 폴더만 참조로 등록한다. 파일 형식·버전·경로 겹침·여유 공간·원본 사용 여부를 확인한다. 초기 MVP는 원본의 저장되지 않은 UI 편집을 자동 수집할 수 없으므로 **Classic에서 해당 공간을 저장하고 닫도록 안내**한다. 앱을 강제로 종료하지 않는다.

그다음 native read-only SQLite snapshot/backup으로 일관된 추출 사본을 만들고 원본 읽기 락을 해제한다. 원본 폴더에 임시 파일/이관 marker를 만들지 않는다. WAL/미완료 transaction/지원하지 않는 버전이면 중단한다. 실제 Windows/macOS의 열린 파일·SQLite backup·비정상 종료를 검증해야 한다. 기존 appController의 flush/finish/close 경계와 모순되는 별도 쓰기 경로를 만들지 않는다.

사본 추출 이후 원본은 Classic에서 다시 열어 사용할 수 있다. 검토 화면에는 사본의 대상·원본/목적지·업무/노트/보드/이미지 수·예상 용량·폴더 연결 제외·오프라인 보관을 보여준다. 전송 동의는 기본 미선택이며 **‘사본 만들기’가 실제 업로드 시작점**이다.

### 3.3 진행·중단·취소

진행 단계는 원본 확인 → 새 사본 → 이미지 전송 → 전체 확인이다. 전체 확인 전에는 새 공간의 ‘열기’를 활성화하지 않는다. 파일 개수와 실제 byte 기준 진행률을 표시하며 재시도/검증 시간을 임의 완료 시간으로 약속하지 않는다.

‘창 닫기’는 작업 취소가 아니다. 진행 기록을 보존하고 ‘이어서 준비하기’를 제공한다. ‘잠시 중단’은 이미 진행 중인 HTTP 요청의 종료를 확인한 뒤 새 전송만 멈춘다. POST 전송 중단 자체를 완료/부재 증명으로 간주하지 않는다.

‘이관 취소’는 별도 확인 → 서버 cancel fence → 기존 IO 정산 대기 → 온라인 파일 삭제/부재 확인 → 취소 완료다. 사용자가 취소를 눌렀다는 이유만으로 파일을 지우거나 용량이 반환됐다고 표시하지 않는다. 불확실한 작업은 ‘결과 확인 중’에 남기며 재조회/진단번호/나중에 확인을 제공한다. 시간 경과만으로 강제 정리하는 버튼은 제공하지 않는다.

[진행](mockups/step6/progress.png) · [미확정 전송](mockups/step6/uncertain.png) · [취소 정리 대기](mockups/step6/canceling.png)

### 3.4 완료·다른 기기 받기

첫 이관 완료는 원본/온라인 사본을 따로 보여주고, 이 기기에 metadata와 이미지가 모두 준비됐는지 확인한 뒤 새 공간을 연다. 다른 기기에서는 계정의 기존 공간을 선택하고 metadata/전체 이미지를 받는다. 로컬 캐시 디스크 여유가 부족하면 원본이나 다른 공간을 지우지 않고 중단한다.

현재 실제 서버의 receipt는 **poc-verified**이며 제품 활성화 조건을 만족하지 않는다. 시안의 완료 화면은 검증된 **제품용** receipt·캐시 형식·지원 capability를 모두 갖춘 뒤의 목표 동작이다. PoC 증표를 verified로 문자열만 바꿔 열지 않는다. 지금 형식이 맞지 않으면 ‘지원하는 앱 버전이 필요합니다’를 보여주고 사본을 보존한다.

### 3.5 저장/전송 상태와 로그아웃

두 축을 분리한다.

| 이 기기 | 온라인 | 표시/행동 |
|---|---|---|
| 저장 완료 | 서버 반영 완료 | ‘이 PC에 저장됨’ + ‘온라인 반영됨’ |
| 저장 완료 | 전송 중/대기 | 로컬 완료 유지 + 대기 건수/마지막 서버 반영 시각 |
| 저장 중 | 미확정 | 로컬 ‘저장 중’, 온라인 완료를 선행 표시하지 않음 |
| 저장 실패 | 어떠한 상태든 | ‘이 기기에 저장하지 못함’을 우선 표시. 재시도/내보내기 |
| 저장 완료 | 인증 만료 | 같은 계정 재로그인. 대기열 보존 |
| 저장 완료 | 다른 기기와 충돌 | 두 버전 보존 후 선택. 임의 덮어쓰기 금지 |
| 저장 완료 | 서버 공간 부족 | 용량 관리/나중에. 원본/이미지 자동 삭제·누락 금지 |

온라인 반영은 서버 revision/cursor ack와 이미지 검증까지 일치할 때다. 로컬 saved 아이콘을 온라인 성공으로 재사용하지 않는다. 동기화/충돌 화면은 **7번 후속 구현의 UI 계약**이며 현재 이관 서버가 실시간 변경분 동기화를 제공한다는 뜻이 아니다.

미전송 변경이 있으면 로그아웃 전에 ‘먼저 동기화’/‘보관 후 로그아웃’을 구분한다. 후자는 인증정보를 지우되 ownerId에 묶인 대기열과 캐시를 유지한다. 다른 계정은 이를 열거나 대신 전송하지 못한다. 계정별 캐시를 완전히 삭제하는 기능은 대기열 내보내기/최종 확인을 별도로 거쳐야 한다. 오프라인 재인증/허용 기간 정책은 구현 전에 확정한다.

[연결 대기](mockups/step6/offline.png) · [다크](mockups/step6/dark-review.png) · [좁은 창](mockups/step6/narrow-review.png)

## 4. Repository·파일·렌더링의 제품 경계

- 현재 src/data/repository.ts는 note_asset의 base64 컬럼을 직접 읽고 쓴다. 온라인 캐시 파일에 이 Repository를 그대로 꽂지 않는다. family별 LocalRepository/ConnectedRepository를 타입과 팩토리에서 분기한다.
- PoC의 generic records/blob_ref DB는 검증 포맷이다. 제품 캐시는 독립 schemaFamily/version·도메인 테이블·immutable asset ref·outbox·cursor 계약을 확정해야 한다. local DB19와 이름만 다른 같은 migration 경로로 관리하지 않는다.
- 온라인의 사용자 편집과 outbox는 한 로컬 트랜잭션으로 저장한다. 이미지 파일은 별도 캐시에서 fsync/atomic rename 완료 후 참조와 outbox를 커밋한다. 메타데이터에 binary/base64를 넣지 않는다. 실패 시 UI가 로컬 saved를 표시하지 않는다.
- 이미지 표시의 과도기 경로는 private cache 파일 → 제한된 native binary IPC → 메모리 display data URL이다. display URL을 DB/metadata JSON/outbox/snapshot에 쓰지 않는다. 기존 img-src data: 범위로 표현 가능하지만 viewport/thumbnail·메모리 상한은 검증한다. Blob URL/custom scheme/CSP 확장은 별도 검토·승인 대상이다.
- 임의 파일 경로를 이미지 IPC 입력으로 받지 않는다. workspace/asset ID와 현재 epoch를 검증해 소유한 캐시만 읽는다. 공간 전환 때 object URL/이미지 캐시·타이머·undo·구독을 해제한다.
- 공간 전환은 기존 appController의 flushPending → finishNote → detachAll → 드라이버 닫기 → activate 순서를 재사용/타입 확장한다. 온라인 실패를 원본 드라이버로 fallback하지 않는다.
- Preview의 계정 token은 OS 보안 저장소에만 둔다. service_role/Management PAT/DB password는 앱/VITE/배포물에 포함하지 않는다. 앱은 사용자 token으로 trusted gateway에 연결하며 server-only RPC는 서버가 호출한다.

## 5. 실제 구현 전 관문과 작업 순서

| 순서 | 작업 | 완료 기준 |
|---|---|---|
| 6-A | 레이아웃·분리 실행 방식 검토 | A/B/C 선택 및 Preview/Classic 관계 확인 |
| 6-B | native 실행 profile/설정/IPC/업데이트 분리 | 양 OS에서 동시 설치/실행, 기존 config/피드 hash 불변 |
| 6-C | 로컬 원본 참조·read-only snapshot | 사용 중/닫힌 DB·WAL·경로 alias·원본 파일 목록/hash 보존 |
| 6-D | 계정/진행 UI와 journal adapter | OTP/SMTP 검증, 키 분리, 닫기/재실행/취소/대기 표시 |
| 6-E | 제품 캐시/Repository·활성화 capability | 검증용 증표 거절, 참조 이미지 조회/내보내기/백업 의미 검증 |
| 6-F | 다른 기기 받기·플랫폼 검증 | owner-bound cache·전체 이미지·공간 전환3회·오프라인 재열기 |

실시간/주기 동기화·변경 충돌은7번, 한/영 번역 전면 적용은8번이다. UI 문구는 connection.localSaved/migration.review.title 같은 리소스 키로 분리할 전제로 길이를 잡는다. DEV의 현재64KiB/8자산/1MiB 한도를 실제182MB/28이미지 지원으로 오인하지 않는다. 시안 수치는 목표 제품 흐름을 설명하는 가상값이며 용량·분할 전송 확장 관문 통과 전에는 실제 업로드를 시작할 수 없다.

별도 release channel·제품용 receipt·cache schema·OTP 운영·로그아웃 후 offline policy는 아직 확정/구현이 남았다. 이번 시안 승인만으로 유료 서비스/운영 배포/기존 feed 변경을 실행하지 않는다.

## 6. 시안 검증과 검토 지점

HTML은 가상 화면만 렌더링한다. native dialog로 배경 전체 blur/클릭 차단·Esc/Tab 동작을 제공하며, 동의 기본 미선택·중단/재개·취소 확인/정리 대기를 체험할 수 있다. 하단 ‘시안 도구’는 검토용이며 제품 UI가 아니다. 430px 검사는 좁은 창 레이아웃 스트레스 시험이고 모바일 앱 구현을 의미하지 않는다.

실제 Chromium의 조합별 렌더링·가로 넘침·키보드/버튼 흐름·외부 요청0 검증 결과는 [시안 검사](evidence/step6-ui-review-check.json)를 따른다. 앱/native/Cloud는 변경하지 않았다.

검토 우선순위는 **① A/B/C 진입 배치 ② 기존 Classic과 별도 Preview 실행 방식 ③ 원본 보존/새 사본 안내와 상태 표현**이다. 추천은 A이며, 선택을 받은 뒤6-B부터 구체 구현 범위를 확정한다. [56철칙](56-local-permanence-copy-migration.md)·[66 실제 DEV 결과](66-development-migration-live-results.md)가 구현의 안전 경계다.
