# 소스 조사 기록

- 조사일: 2026-11-03 (Asia/Seoul)
- 대상: [chs2147/work-journey-board](https://github.com/chs2147/work-journey-board)
- 기준 커밋: [`10ff78c715bc651a28739d6e5befa94f9dffbbc7`](https://github.com/chs2147/work-journey-board/commit/10ff78c715bc651a28739d6e5befa94f9dffbbc7)
- 방법: 연결된 GitHub 도구로 기본 브랜치·커밋·파일 트리를 확인하고 아래 파일을 읽었다. 실제 업무 일지·운영 DB·사용자 폴더는 조회하지 않았다.

## 1. 읽은 근거

| 고정 커밋의 파일 | 확인 목적 |
| --- | --- |
| [README.md](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/README.md) | 기존 기능·설치 대상·사용자 데이터 정책·버전 이력 |
| [CLAUDE.md](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/CLAUDE.md) | 개발 계층·로컬 데이터·실제 업무 기록 금지·파일 안전·AI 범위 |
| [package.json](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/package.json) | 앱 1.7.1·실제 의존성·검증 명령 |
| [docs/multi-board-spec.md](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/docs/multi-board-spec.md) | 사용자 검토 대기, Universe 후속·9절 읽기 전용 다중 일지 방향 |
| [docs/data-spec.md](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/docs/data-spec.md) | 기본 데이터 규칙·ISO 주차·백업·저장소 계약 |
| [docs/output-spec.md](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/docs/output-spec.md) | 사내 AI 클립보드 지시문·복사 전 미리보기·추측 금지 |
| [docs/renewal/design-style-spec.md](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/docs/renewal/design-style-spec.md) | Warm Beige·서체·상태·접근성·모션 |
| [src/domain/types.ts](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/domain/types.ts) | Category·EntryItem·depth·중요/시각 필드 |
| [src/domain/search.ts](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/domain/search.ts) | 2글자·AND 부분 일치·300건·메모 텍스트 추출 |
| [src/domain/note.ts](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/domain/note.ts) | 주간 NoteDoc·BoxRef·NoteEdge·그림/링크·레거시 메모 변환 |
| [src/domain/cabinet.ts](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/domain/cabinet.ts) | CabinetItem·CabinetLink·폴더 읽기 경계 |
| [src/data/repository.ts](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/data/repository.ts) | 실제 검색·원본 조회·셀/메모 저장·Cabinet·갱신 시각 |
| [src/data/migrate.ts](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/data/migrate.ts) | 마이그레이션 실행·최신 스키마 10 |
| [src/data/migrations/0001_init.sql](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/data/migrations/0001_init.sql) | 항목·업무·메모·요약의 초기 스키마 |
| [src/data/migrations/0003_week_note.sql](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/data/migrations/0003_week_note.sql) | 주간 문서 JSON·이미지 자산 저장 |
| [src/data/migrations/0009_cabinet.sql](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/data/migrations/0009_cabinet.sql) | Cabinet과 연결의 DB 제약 |
| [src/data/session.ts](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/data/session.ts) | 일지 열기·복원·백업·전환 관련 동작 |
| [src/ui/search/searchStore.ts](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/ui/search/searchStore.ts) | 검색 UI 상태·원본 이동·주차 이동 |
| [src/ui/common/appStore.ts](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/ui/common/appStore.ts) | 앱 수준 저장소/세션 상태 |
| [src/ui/common/Rail.tsx](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/ui/common/Rail.tsx) | 기존 진입 메뉴 |
| [src/ui/common/Rail.module.css](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/ui/common/Rail.module.css) | 실제 레일 52px·버튼 40px |
| [src/ui/App.module.css](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/ui/App.module.css) | 기존 작업 영역의 flex 구조 |
| [src/shared/tokens.css](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/shared/tokens.css) | 실제 테마별 값·역할 매핑 |
| [src/shared/palette.ts](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/shared/palette.ts) | 기존 업무 색 c1~c8 |
| [src/shared/brand/wordmark.svg](https://github.com/chs2147/work-journey-board/blob/10ff78c715bc651a28739d6e5befa94f9dffbbc7/src/shared/brand/wordmark.svg) | 기존 브랜드 벡터 자산 |

README는 커밋 고정 전에 기본 브랜치에서 먼저 읽었으며, 조사 당시 파일 트리와 동일 버전 1.7.1을 표시했다. 다른 선택 소스는 기준 커밋을 지정해 읽었다. 세컨드 브레인 전용 구현 파일은 이 트리에서 확인되지 않았다.

## 2. 기존 기능으로 확인한 것

1. 주간·데일리 기록, 중요 항목·반복·시작 시각·다른 날 이동.
2. 통합 키워드 검색. `search()`는 기록·메모의 최대 300건, Cabinet은 `searchCabinet()` 결과를 따로 제공한다.
3. 업무별 타임라인·경과 지도·활동 히트맵은 README와 관련 코드 연결에서 확인했다. 이번 조사에서 인사이트 전체 구현을 실행·검증하지는 않았다.
4. 주간 메모 JSON의 상자·같은 주 항목 참조·상자 관계선, 그림 설명과 링크 카드.
5. Cabinet은 등록 제목·폴더/URL·업무/항목 관계를 저장한다. 외부 파일 본문·사이트 내용 수집은 현 범위가 아니다.
6. SQLite 단일 일지, 같은 스키마의 Tauri/sql.js, 마이그레이션·백업·복원.
7. 시그니처 테마의 고운돋움 400·가짜 볼드 금지, 기존 색 토큰.

## 3. 검토 중인 것과 신규 제안

| 구분 | 내용 |
| --- | --- |
| 검토 중 기존 기획 | 멀티 작업 공간의 명칭·분리 DB·전환 UI·온보딩. 문서는 사용자 검토 대기라고 명시 |
| 기존 후속 방향 | Universe가 여러 일지를 읽기 전용으로 열고 현재 공간에만 쓰기. 공간 간 영속 관계는 따로 결정 |
| 이번 신규 제안 | 현재 일지의 지식 지도·여러 주 수동 연결·지식 카드·출처 지문·질문별 근거 묶음·요구사항 U-01~20 |
| 후속 결정 | 명칭 확정, 멀티 공간 선후, 직접 AI·의미 검색·파일 본문 읽기 |

멀티 보드 문서의 ‘추천’ 표와 판 번호 예시는 사용자 승인·배포된 사실로 바꾸지 않았다. 또한 오래된 data-spec의 초기 테이블 개수보다 실제 마이그레이션 목록·현재 타입을 우선해 현재 구조를 판단했다.

## 4. 검증하지 않은 것

- 저장소 전체의 모든 파일을 읽은 것은 아니다.
- 앱 실행·실제 설치판·Windows/macOS 실기·기존 UI의 전체 픽셀 측정을 수행하지 않았다.
- GitHub Pages 화면이나 제품 스크린샷의 모든 상호작용을 확인하지 않았다.
- FTS5 지원, 최신 그래프 라이브러리, 모델 공급자·API 가격·임베딩 품질을 조사하지 않았다. 관련 항목은 전제·구현 완료로 적지 않았다.
- 영상 전체 스크립트·음성은 확보하지 못했다. [영상 분석의 확인 범위](VIDEO_ANALYSIS.md)를 따른다.
- 실제 사용자의 업무 패턴·검색 성공률·재사용 빈도를 관측하지 않았다. 수치 목표는 검증할 가설이다.

## 5. 산출물 검수와 변경 경계

이 패키지의 마크다운 링크·이미지 경로·요구사항 ID·SVG 구조를 검수하고 PNG 예시의 글자·배치를 확인한다. 제품 구현 검증과 구분한다.

실제 GitHub 저장소에는 코드·문서·커밋·이슈·PR·릴리스를 생성하거나 수정하지 않았다. 현재 AI 토피아 작업 폴더에도 이 패키지를 넣지 않았다. `.research/`는 조사한 공개 코드의 로컬 참고 사본이며 최종 공유 ZIP에는 포함하지 않는다.


## 정적 산출물 검수 완료

2026-11-03에 마크다운 6개 문서의 로컬 링크·이미지 경로·코드 펜스, U-01~U-20 요구사항 ID, 잘못된 프로젝트 용어 유입 여부, SVG XML·텍스트 좌표를 검사했다. 3개 화면을 1440×900 PNG로 렌더링해 한글 표시·글자 잘림·패널 배치를 직접 확인했다. 실제 앱 테스트·실기·접근성 자동 검사를 수행한 결과는 아니다.
