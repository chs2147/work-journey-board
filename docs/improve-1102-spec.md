# 2026-11-02 개선 — Cabinet 다듬기·스플래시 버전 표시 (상세 설계)

> 작성: 2026-11-01 · 기준: `v1.3.0` · 상태: **추천안 자동 승인(사용자 지시: "결정할 특이사항이 없다면 자동 승인하고 바로 구현") → 구현 `v1.4.0`**
> 시안 = 구현 화면(가상 샘플) 캡처 `docs/mockups/1102b/` — 이번 묶음은 사용자가 결정할 갈림길이 없어 설계 → 구현 → 캡처 순서로 진행.

| # | 요청 | 설계(추천안 = 채택) |
|---|---|---|
| C1 | Cabinet 창이 앱 안에서만 움직임 → 폴더 창처럼 앱 밖 별도 창 | 실앱: Cabinet을 **별도 OS 창**(`cabinet`)으로. 브라우저 모드(개발·E2E)는 지금처럼 앱 안 떠 있는 창 |
| C2 | 왼쪽 '업무별'에 진행 중 업무 전부(0개 포함) + 맨 위 '전체' | 맨 위 **전체**(모든 폴더·링크) → **진행 중(종료 안 된) 업무 전부**(개수 0도) → 종료된 업무는 연결된 것이 있을 때만(흐리게 "종료") → 연결 없음(있을 때만). 처음 열면 '전체' |
| C3 | 목록 줄을 끌어 다른 업무에도 소속 | 오른쪽 줄을 끌어 왼쪽 업무에 놓으면 **그 업무 연결을 더함**(기존 연결 유지). 놓을 수 있는 업무는 테두리 강조, 이미 연결돼 있으면 안내 |
| C4 | 목록 줄을 끌어 순서 바꾸기 | 같은 목록 안에서 끌면 파란 선 위치로 이동. 순서는 앱 전체 하나(`sort_order`) — 지금 보는 묶음 안의 앞뒤 관계대로 전체 순서에 반영 |
| C5 | 크롬 주소창 아이콘 끌어 놓기가 "폴더만 등록" 오류 | 놓은 자료에 **링크(주소)가 함께 있으면 링크 우선**. 폴더 경로가 있을 때만 폴더 등록. 크롬이 함께 넘기는 인터넷 바로 가기(`*.url`)는 파일로 보지 않고, 주소가 없으면 그 바로 가기 안의 `URL=`을 읽어 링크로(이름 = 파일 이름) |
| C6 | '탐색기에서 열기'가 상위 폴더에서 선택된 채로 열림 | 등록 폴더·폴더 창의 [탐색기에서 열기] = **그 폴더 안으로 열기**(opener `open_path`). 폴더 창에서 **파일**을 골라 둔 경우에만 그 파일을 선택한 채 열기 |
| C7 | 주간·데일리 뷰 업무 이름 옆에도 Cabinet 바로가기 | 업무에 연결된 폴더·링크(업무 연결 + 그 업무 항목 연결)가 있으면 이름 옆 🗄 + 개수 — 하나면 바로 열기, 여럿이면 Cabinet을 그 업무로. ⋯ 메뉴 [Cabinet 열기]는 그대로 |
| S1 | 스플래시 버전을 설정 › 업데이트·정보처럼, 타이틀 뒤에 '버전 1.x.x' | 워드마크 바로 뒤(같은 줄 오른쪽 아래)에 `버전 1.4.0`, 아래쪽 `v1.4.0` 줄은 없앰 — 표기는 설정 화면과 같은 `버전 X.Y.Z` |
| G | 공통 규칙: 가이드 차이 반영 | 장면 02(업무 이름 옆 🗄)·11(Cabinet 별도 창·전체·끌어 옮기기·탐색기 열기) 글·스크린샷·PDF 갱신, 릴리스 노트 `## 가이드` |

## C1 Cabinet 별도 창 — 구조
- 창 `cabinet`(같은 앱 화면 `index.html?win=cabinet`) — **일지를 열지 않는다**. 메인 창이 일지의 유일한 주인(쓰기 주체 1개, data-spec 3-1)이고, Cabinet 창은 Tauri 이벤트로 메인 창에 묻는다.
  - 읽기: 메인 창이 Cabinet 자료(항목·연결·업무·이번 주 항목·열린 폴더 창)를 `cabinet-sync`로 보낸다(바뀔 때마다).
  - 쓰기: Cabinet 창의 등록·고치기·연결·순서·해제·되돌리기는 `cabinet-rpc`로 메인 창 저장소(`JournalRepository`) 메서드를 부른다(허용 목록만) → 메인 창이 다시 읽고 `cabinet-sync`.
  - 폴더 창 열기·하위 위치·열린 창 기억은 지금처럼 메인 창이 맡는다(`openFolder` 요청).
- 권한 `capabilities/cabinet.json`: 폴더 고르기 대화상자·클립보드 쓰기·창 상태 — DB·네트워크 없음. 탐색기 폴더 끌어 놓기 다리(A안)는 Cabinet 창에도 단다(Rust `cabinet_drop_bridge`, 창마다 한 번).
- 위치·크기 = window-state(창 이름별). 앱을 켤 때 열려 있었으면 다시 연다(`config.json` `cabinet.open`). 앱을 닫으면 함께 닫힌다. `Alt+4` = 열기/닫기(Cabinet 창 안에서도), `Esc`(창 안 대화상자가 없을 때) = 닫기.
- 보드 🗄·업무 머리 메뉴·검색 결과에서 열 때 고를 업무·강조할 항목은 `cabinet-focus`로 넘긴다.

## C3·C4 끌기
- 끌기 자료 형식 `application/x-wjb-cabinet`(앱 안에서만) — 등록용 놓기(파일·링크)와 섞이지 않는다.
- 업무에 놓기 = `setCabinetLinks(기존 + 그 업무)`, '전체'·'연결 없음'에는 놓을 수 없다. 순서 = `reorderCabinet(전체 순서)`. 둘 다 구조 변경 없음.

## 테스트
- 단위: `cabinetGroups`(전체·진행 중 0개·종료·연결 없음), `moveBefore`, `.url` 해석, 끌어 놓기 우선순위.
- E2E(브라우저 모드): 전체·0개 업무, 업무에 끌어 놓기, 순서 끌기, 크롬식 놓기(파일 + 주소), 탐색기 열기 = 폴더 열기, 업무 이름 🗄, 스플래시 버전 표기.
- 실앱(회사 PC 확인표 7-30): Cabinet 별도 창·창 위치 기억·Cabinet 창으로 탐색기 폴더 놓기·크롬 주소 아이콘 놓기.

## 구현 기록(2026-11-01)
- 시안(구현 화면 캡처): [c1c2-cabinet-all.png](mockups/1102b/c1c2-cabinet-all.png)(전체·진행 중 업무 0개 포함 — 브라우저 모드라 앱 안 창) · [c7-category-badge.png](mockups/1102b/c7-category-badge.png) · [s1-splash-version.png](mockups/1102b/s1-splash-version.png)
- C1: `ui/cabinet/CabinetWindowApp.tsx`(창 `cabinet`, `?win=cabinet&t=테마&f=처음 고를 것`) + `Platform.cabinetWindow`(tauri.ts — 열기·닫기·`cabinet-rpc`/`cabinet-rpc-result`·`cabinet-sync`·`cabinet-focus`) + `cabinetStore` remote 모드(저장소 메서드 허용 목록 6개만 메인 창에 부탁, 읽기는 메인 창이 보내는 자료). Rust `cabinet_drop_bridge`(창마다 한 번, `DropBridges`), `capabilities/cabinet.json`. 앱을 닫으면 폴더 창과 함께 닫힘(`closeAll`).
- C2: `domain/cabinet.ts` `cabinetGroups`(+ `ALL_GROUP`), 진행 중 업무 = 열린 기간이 있는 업무. 항목으로 열면 '전체'에서 그 줄 강조.
- C3·C4: 끌기 자료 `application/x-wjb-cabinet`, `addItemToCategory`(연결 더하기) · `reorderItem` + `moveInOrder`(화면 먼저 바꾸고 `reorderCabinet`).
- C5: `handleDrop` — 폴더 경로가 있으면 폴더, 아니면 주소 우선, `*.url`은 파일로 보지 않고 `parseUrlShortcut`·`urlShortcutTitle`.
- C6: 등록 폴더 [탐색기에서 열기] = `cabinetOpen`, 폴더 창은 파일을 골랐을 때만 `cabinetReveal`.
- C7: `CabinetCategoryBadge`(주간 뷰 업무 머리·데일리 뷰 카드 이름 옆), `categoryItems`.
- S1: `splash.html` 워드마크 옆 `버전 %APP_VERSION%`.
- 가이드: 장면 02·11·부록 글, 스크린샷·HTML·PDF 다시 생성(기준 판 1.4.0).
- 테스트: 단위 `cabinet.test.ts` +3·`splash.test.ts`, E2E `cabinet.spec.ts` 5건(새 1건)·`splash.spec.ts`, Rust `cargo test`·윈도우 대상 `cargo check`. 회사 PC 확인표 7-30.
