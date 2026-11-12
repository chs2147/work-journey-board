# Feature List 운영 구조

현재 기준: **Work Journey Board 1.35.0 · DB 구조 v20 · 문서 스키마 1**.

정식 릴리스에도 검토용 Excel과 `SHA256SUMS_features.txt`를 설치 파일과 함께 첨부한다.

[현재 기능 목록](CURRENT.md) · [검토용 Excel](exports/work-journey-board/Work-Journey-Board-Feature-List-v1.35.0.xlsx)

## 1. 목적과 범위

현재 앱의 기능을 고정 ID와 도입 근거로 관리한다. 이 작업은 **문서 운영**이며 앱에 Feature List 화면이나 기능 토글을 추가하지 않는다. 버전·파생 제품·설치 패키지를 서로 다른 축으로 다룬다.

- **제품(productId)**: 독립한 기능 범위와 자체 앱 버전을 가진 제품 계열. 현재 실제 제품은 `work-journey-board` 하나다.
- **앱 버전**: 기능이 제공되는 semver. 최초 제공 버전은 비RC 출시 기록에서 확인된 최초 판으로, 0.x 개발판도 포함한다. 처음 정식 출시한 1.0.0과 다르다. RC 선행 구현은 `preview`에 별도로 기록한다. 아직 비RC 판에 제공되지 않은 RC 전용 기능은 `introduced: null`, 실제 `preview`와 active 상태를 기록하며 Excel에는 **RC 제공만**으로 표시한다. 카탈로그/제품 버전에는 RC를 사용할 수 있고 RC 숫자는 semver 순서로 비교한다.
- **배포 프로필(profileId)**: 같은 제품·같은 버전의 Windows 기본판, macOS 유니버설, Windows 오프라인 패키징. 오프라인은 다른 앱 제품이 아니다. 지원되는 프로필과 해당 릴리스에서 실제 빌드된 산출물도 구분한다.
- **문서 schemaVersion / DB 구조**: 문서 형식 번호와 일지 DB 구조 번호는 앱 버전과 별개다. v15 문서 정리는 DB 구조를 바꾸지 않았다. v16 공유 메모 연결부터 일지 구조 v15를 사용한다.

## 2. 파일 구조와 정본

```text
features/
  README.md                         운영 규칙
  catalog.json                      Feature ID·현재 동작·도입/개선/제거 이력 정본
  schema.json                       문서 필드 계약(JSON Schema)
  CURRENT.md                        사람이 읽는 현재 목록(생성물)
  profiles.json                     공통 → 배포 프로필 상속·재정의 정본
  products/work-journey-board.json   현재 제품 버전·카탈로그·기본 배포 프로필
  releases/<productId>/v<version>.json  버전별 고정 목록과 프로필 해석 결과
  exports/<productId>/*-v<version>.xlsx 검토용 Excel(생성물)
  templates/derivative-product.json 독립 파생 제품 등록 예시(미제공)
  templates/derivative-profile.json 같은 제품의 새 패키징 예시(미제공)
scripts/features/generate.mjs        생성·검사 명령(앱에서 사용하지 않음)
```

`catalog.json`과 `profiles.json`이 정본이다. 상세 설계·출시 노트는 각 행의 근거다. Markdown과 Excel은 정본에서 만들며 다른 표현으로 수동 분기하지 않는다. 제품 버전은 제품 정의 파일에, DB 구조는 카탈로그 메타데이터에 남긴다.

1.18.0 스냅샷은 **과거 출시 이력으로 소급 작성한 최초 기준선**이다. 당시 별도로 작성·승인된 Feature List 원본이라고 주장하지 않는다. 1.18.1부터 변경과 스냅샷을 함께 관리한다.

## 3. 기능 레코드 규칙

| 필드 | 의미 |
|---|---|
| `id` | `WJB-영역-일련번호`. 최초 발급 후 이름 변경에도 유지하며 재사용 금지 |
| `area / section / kind` | 영역·세부 영역·제품 기능/배포·플랫폼/개발 운영 분류 |
| `name / description / entry` | 현재 이름·제공 동작·앱 진입 영역 |
| `introduced / preview` | 최초 비RC 제공 버전 / RC 선행 구현. 미제공 계획은 null |
| `history / lastChanged` | 도입·개선·제거 버전, 변경 내용·근거. 최근 개선은 도입과 다름 |
| `status / retired` | active / retired / planned, 제거된 버전. 제거/계획은 현재 기능 수에서 제외 |
| `platforms / platformSince` | 플랫폼별 지원 여부와 지원 시작 버전. 기존 Windows 기능의 macOS 지원은 1.6.0부터 |
| `sources / implementation` | 명세·README·출시 노트와 현재 소스 위치. UI 명칭이 바뀌어도 근거 연결 유지 |
| `verification` | 이번 목록의 확인 수준. 출시 이력·문서·소스 위치 대조가 기능별 실기 전수 검증을 뜻하지 않음 |
| `reviewStatus / reviewNote` | 정본의 검토 기록. Excel 검토 사본 의견은 확인 후 수동 반영 |

기능 단위는 사람이 설명·검토할 수 있는 동작/정책이다. 같은 기능을 단순히 이름이 바뀌었다고 중복 등록하지 않는다. 버그 수정·디자인 개선은 해당 기능의 `history`에 남긴다. 카탈로그 항목 수를 릴리스 노트의 개선 건수나 화면 버튼 개수와 동일시하지 않는다.

Universe 지도·직접 관계는 각각 RC에서 먼저 검증했지만 main에서 함께 제공한 비RC 버전은 1.12.0이다. 시그니처 타임라인 구분선은 1.18.0 도입, 1.18.1 대비 개선으로 기록한다. 설계에만 있는 기간 막대·주별 비중·AI API는 현재 제공 목록과 분리한다.

## 4. 파생 제품과 프로필

현재 프로필은 `base-common → windows-standard / macos-universal`, `windows-standard → windows-offline`이다. 상속 후 명시한 포함/제외를 적용하며 플랫폼 미지원은 포함으로 뒤집지 않는다. 재정의에는 Feature ID와 이유가 필수다. 존재하지 않는 ID·중복 재정의·부모 순환은 검사에서 차단한다.

독립한 파생 앱을 만들 때는 다음을 지킨다.

1. 새 `productId`와 제품 정의를 만든다. 상위 제품의 **고정 버전 스냅샷**을 `upstream`으로 지정한다. main 최신 카탈로그를 자동 상속하지 않는다.
2. 상위 Feature ID는 유지한다. 포함/제외·동작 차이·대체 기능 ID와 이유를 적는다. 새 기능은 전역에서 충돌하지 않는 새 ID를 발급한다.
3. 파생 앱의 자체 버전과 `introducedInProduct`를 별도로 기록한다. 예를 들어 파생 앱 0.1.0에 상위 1.12.0 도입 기능이 포함되어도 두 semver를 크기로 비교하지 않는다.
4. `releases/<새 productId>/v<자체 버전>.json`과 전용 Excel로 범위·차이를 검토한다. 상위 기능의 최초 버전과 파생 앱의 로컬 도입 버전을 각각 표시한다.
5. 상위 버전을 올릴 때는 이전/다음 스냅샷의 ID 차이를 검토하고 추가·제거·변경을 명시적으로 수용한다.

현재 생성 도구는 실제 기준 제품과 세 배포 프로필을 관리한다. `templates/`는 등록 계약을 설명하는 미제공 예시이며 현재 제품 수·포함 기능 수·배포 파일로 집계하지 않는다. 독립 파생 제품을 실제 등록하는 작업에서는 해당 제품의 버전 축을 반영한 생성 명령도 함께 연결한다.

## 5. 버전별 변경 절차

1. 앱 변경 시 해당 ID의 동작·개선 이력·근거를 갱신한다. 신규 ID, 제거 버전, 계획→제공 전환도 기록한다.
2. 앱 판올림과 함께 `catalogVersion`, 제품의 `currentVersion`, 기준일·DB 구조·출시 근거를 갱신한다. 제품별 버전은 섞지 않는다.
3. `node scripts/features/generate.mjs build`로 현재 Markdown·현재 스냅샷·Excel을 만든다.
4. `node scripts/features/generate.mjs check`로 ID·버전·근거 경로·상속·현재 스냅샷·Excel의 각 셀을 검사한다. CI에서도 실행한다.
5. Excel의 기능 목록/버전/파생판/근거를 검토하고 모두 함께 커밋한다. 과거 버전의 스냅샷과 Excel은 보존한다.
6. 릴리스 성공과 설치 파일 존재는 Actions/Release에서 별도 확인한다. 문서 스냅샷이 존재하는 것만으로 배포 성공을 뜻하지 않는다.

과거 스냅샷은 새로운 기능 추가 때 다시 계산해 덮어쓰지 않는다. 오기 정정은 사유·검토자·기존 파일을 남긴 새 revision 파일로 관리한다. 현재 버전 생성은 검토 전 원본을 재생성하므로 의견은 아래 검토 사본에 쓴다.

## 6. Excel 검토

10개 시트: 안내 / 현재 기능 / 버전별 포함 / 파생판 비교 / 기능 변경 이력 / 버전 목록 / 근거 문서 / 현재 미제공 / 운영 규칙 / 검토 입력.

필터·고정 머리·줄바꿈·출시 근거 링크·색 구분을 제공한다. `09_검토입력`의 노란 셀에 상태(미검토/확인/수정 요청/보류), 검토자, 의견, 처리 근거를 작성한다. **다른 이름의 사본**으로 보관해 생성물 재작성과 의견을 분리한다. 검토 결과를 정본에 반영한 뒤 다시 생성하며 Excel에서 바꾼 내용이 앱이나 카탈로그를 자동 변경하지 않는다.
