# 2026-11-02 개선 v7 — 보드 열 폭·Cabinet 다듬기 2·메모 다중 선택 (상세 설계)

> 작성: 2026-11-02 · 기준: `v1.4.0` · 상태: **추천안 자동 승인(사용자 지시: "결정할 특이사항이 없다면 자동 승인하고 바로 구현") → 구현 `v1.5.0`**
> 시안 = 구현 화면(가상 샘플) 캡처 `docs/mockups/1102v7/`.

| # | 요청 | 설계(추천안 = 채택) |
|---|---|---|
| K1 | 주간 뷰 업무·요일 열 가로폭 조절 | 열 머리 오른쪽 끝 손잡이를 끌어 폭 지정(업무 열 120~400px, 요일 열 80~900px). **요일마다 따로**(월~일 자리 기준 — 주를 넘겨도 유지). 두 번 누르면 그 열만 자동(지금 규칙: 포커스 요일 넓게·빈 주말 좁게). 손잡이에 포커스 후 `←`/`→` 16px. 일지 설정 `ui.boardColW { label, days[7] }`(null = 자동) — 구조 변경 없음. 합이 창보다 넓으면 보드가 가로로 스크롤 |
| K2 | Cabinet에 특정 폴더가 끌어 놓기로 안 들어감 | 원인 후보를 모두 처리: ① 윈도우 **바로 가기(`.lnk`)**를 끌면 파일로 취급 → 바로 가기가 가리키는 폴더로 등록(Rust가 바로 가기 대상 경로만 읽음) ② 긴 경로 접두어(`\\?\`·`\\?\UNC\`)가 붙은 경로를 절대 경로로 못 알아봄 → 정리 ③ 압축 파일(`.zip`, 탐색기에선 폴더처럼 보임)·찾을 수 없는 경로는 이유를 구분해 안내(무엇을 놓았는지 이름 표시) |
| K3 | 등록 목록에서 바로 '탐색기에서 열기' | 폴더 줄에 [탐색기에서 열기] 아이콘 단추(↗ 옆) — 그 폴더 안으로 |
| K4 | 등록 폴더가 유효한지 검사(이름 변경·이동·삭제) | Cabinet 머리 [폴더 확인] 단추 + Cabinet을 열 때·창으로 돌아올 때 자동 확인. 찾을 수 없는 폴더 줄은 ⚠ "찾을 수 없음" 표시, 열기 대신 안내. ⋯ › **경로 다시 지정…**(폴더 고르기 → 연결·제목 그대로 경로만 바꿈) |
| K5 | 폴더 창 새로 고침(탐색기에서 바꾼 것 반영) | 폴더 창 머리 [새로 고침] 단추(`F5`) + 열려 있는 폴더 창은 **3초마다·창으로 돌아올 때 자동**(바뀐 게 있을 때만 다시 그림, 고른 줄 유지). 지금 폴더가 사라지면 안내 + [위로] |
| K6 | Cabinet 업무 목록 ↔ 폴더·링크 목록 사이 폭 조절 | 사이 구분선을 끌어 왼쪽 폭 160~420px, 두 번 누르면 기본(210px), `←`/`→`. 이 PC에 기억(창별 화면 취향 — localStorage) |
| K7 | 메모 보드에서 사각형으로 여러 상자 골라 한꺼번에 옮기기 | 빈 곳을 **끌면 선택 사각형**(살짝 누르기만 하면 지금처럼 그 자리에 새 상자). 걸친 상자가 함께 선택(파란 테두리) → 그중 하나를 끌면 함께 이동(되돌리기 한 번), 방향키로 함께 조금씩, `Delete` 함께 지우기(되돌리기), `Esc`·빈 곳 누르기로 해제. `Shift`+상자 누르기 = 선택에 더하기/빼기 |
| K8 | 업무 항목 끌기 표시(⋮⋮)가 작아 잘 안 보임 | 손잡이를 18px 폭·글자 15px로 키우고 마우스를 올리면 옅은 바탕 + 진한 색, 잡을 수 있는 자리도 넓힘(본 항목·세부 항목 모두) |

## 테스트
- 단위: `normalizeFolderPath`(긴 경로 접두어), 열 폭 설정 검사(`validBoardColW`·`mergeSettings`). 메모 사각형 겹침은 화면 위치로 판정하므로 E2E에서.
- E2E: 열 폭 끌기·두 번 누르기·주 넘겨 유지, Cabinet 폴더 확인·찾을 수 없음·경로 다시 지정, 줄 탐색기 단추, 폴더 창 새로 고침·자동 반영, 구분선 끌기, 메모 사각형 선택·함께 이동·Delete·되돌리기, 손잡이 크기.
- 실앱(회사 PC 확인표 7-31): `.lnk` 바로 가기 끌어 놓기, 긴 경로·네트워크 폴더 놓기, 탐색기에서 이름 바꾼 뒤 폴더 확인·폴더 창 자동 반영.

## 구현 기록(2026-11-02)
- 시안(구현 화면 캡처): [k1-board-colwidth.png](mockups/1102v7/k1-board-colwidth.png) · [k3k4k6-cabinet.png](mockups/1102v7/k3k4k6-cabinet.png)(⚠ 찾을 수 없음·줄 탐색기 단추·[폴더 확인]·넓힌 업무 목록) · [k5-folder-refresh.png](mockups/1102v7/k5-folder-refresh.png) · [k7-marquee.png](mockups/1102v7/k7-marquee.png) · [k7-selected.png](mockups/1102v7/k7-selected.png)
- K1: `data/settings.ts` `boardColW`(+ `validBoardColW`·`BOARD_COL_W`), `ui/board/colWidths.ts`·`ColResizer.tsx`(업무 열 머리·요일 머리). 정한 폭이 하나라도 있으면 나머지 자동 열은 최소 140px(글자가 세로로 쪼개지지 않게) — 보드가 가로로 넘친다.
- K2: `normalizeFolderPath` 긴 경로 접두어, Rust `cabinet_resolve_shortcut`(IShellLinkW로 `.lnk` 대상 경로만, `windows` 기능 `Win32_System_Com`·`Win32_UI_Shell`·`Win32_Storage_FileSystem` — tauri와 같은 판), `Platform.resolveShortcut`·`DroppedPath.exists`, 놓기 결과를 이름과 이유(바로 가기·찾을 수 없음·압축 파일·파일·경로 형식)로 안내.
- K3·K4: 폴더 줄 [탐색기에서 열기] 아이콘 단추, `checkFolders`(Platform.stat — 열 때·목록이 바뀔 때·창 포커스·[폴더 확인]), `relocateItem`(폴더 고르기 → `updateCabinetItem` target).
- K5: 폴더 창 [새로 고침]·`F5`·3초마다·창 포커스 — 목록 서명이 같으면 다시 그리지 않음.
- K6: Cabinet 업무 목록 폭 구분선(160~420px, localStorage `wjb.cabinetSideW`).
- K7: `noteStore` `multi`·`setMulti`·`toggleMulti`·`moveBoxesLive`·`nudgeBoxes`·`deleteBoxes`, `boxShared.startGroupDrag`, `NoteCanvas` 빈 곳 끌기 = 선택 사각형(누르기만 = 새 상자, 놓을 때 만듦), `data-multi` 표시, 방향키·Delete·Esc·`Ctrl+Z`.
- K8: 끌기 손잡이 18px·15px 글자·잡는 자리 넓힘·마우스 올리면 바탕.
- 가이드: 장면 02·05·11 글, 스크린샷·HTML·PDF 다시 생성(기준 판 1.5.0).
- 테스트: E2E `improve-v7.spec.ts` 4건, 단위(설정·경로 정리), Rust `cargo test`·윈도우 대상 `cargo check`. 회사 PC 확인표 7-31.
