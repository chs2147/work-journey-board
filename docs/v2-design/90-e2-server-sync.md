# 90. E-2 — 서버 동기화(기록별 판·변경 순번·보내기/받기, 구현 기록)

2026-11-15 · `v2-design` · 설계 [88](88-e-stage-sync-design.md) 승인 범위 "개발 서버만: 전진 SQL 019~·gateway 재배포" · 앞 단계 [89 E-1](89-e1-device-journal.md) · main 미반영

## 1. 서버 SQL 019 (개발 프로젝트 `vsphftnmfzfoufasjttd`에만 적용, 운영 미적용)

| 객체 | 내용 |
|---|---|
| `wjb_sync.space` | 동기화를 시작한 공간(게시된 작업 1개당 1행) — 대상 표 목록(`kanban_ctx` 제외)·마지막 변경 순번 `seq` |
| `wjb_sync.record` | 기록(표·키)별 **지금 값**·판 `rev`·변경 순번 `seq`. 값 `NULL` = 지움 표시. 게시본 기록은 처음 동기화 때 한 번 복사(`rev 0`·`seq 0`) |
| `wjb_sync.applied` | 처리한 보내기 요청(요청 번호 `opId` + 요청 해시 + 결과) — 같은 요청 = 같은 결과, 다른 내용 = `SYNC_IDEMPOTENCY_MISMATCH` |
| `wjb_sync.asset_declared` | 게시 뒤 새로 붙인 그림의 신고(공간·객체·해시·크기) |
| `public.wjb_v2_workspace_sync` | 서버 전용(service_role만). `push` / `pull` / `asset_declare` |
| `wjb_migration.asset_gate` | 001 그림 문지기를 한 가지만 넓힘: **동기화 중인 게시 공간 + 신고된 같은 해시·크기**도 예약 허용(그 밖은 그대로 거절). 021이 001 원문으로 되돌림 |

모든 표 RLS·권한 없음, 보조 함수 실행 권한 없음, `search_path=pg_catalog`(020 검사).

### push (보내기)
- 한 요청 1~500건, 본문 1.1MB 이하, 값 하나 256KB 이하. 건마다 `{table, key, baseRev, value}` — `baseRev = null`은 새 기록, `value = null`은 지우기.
- 공간 단위로 한 번에 하나(행 잠금). **기대 판이 하나라도 다르면 아무것도 적용하지 않고** 충돌 목록(서버의 지금 판·값)을 돌려준다 — 마지막 저장으로 덮어쓰지 않음.
- 그림 본문 거절: 값에 `data:…;base64,`가 있으면 `SYNC_INLINE_IMAGE`. `note_asset`·`cabi_asset`의 `dataRef`·`thumbRef`는 **같은 공간의 ready 비공개 그림**(해시·크기 일치)만 — 아니면 `SYNC_ASSET_NOT_READY`.
- 살아 있는 기록 20,000건 한도(`SYNC_LIMIT`).

### pull (받기)
- `after`(순번) 이후 변경을 순번 순으로, 1,000건·약 900KB 단위 페이지 → `{changes, more, next, head}`. 지움 표시는 `value: null`로 온다. 앞선 순번이면 `SYNC_CURSOR_AHEAD`.
- 새 기기는 D단계 게시본 캐시(순번 0 기준) + `after=0`부터 받으면 지금 상태가 된다.

### asset_declare (새 그림 신고)
- 신고 → 기존 gateway 그림 경로(예약 → 올리기 → ready) → 참조를 담은 기록 push. 같은 객체를 다른 내용으로 신고하면 `SYNC_ASSET_CONFLICT`. 공간당 5,000개.

## 2. gateway v11
- 경로 `POST /v2/sync/{push|pull|asset_declare}` — 사용자 토큰 확인 → 서버 전용 RPC(`sync-rpc.mjs`, 모양 검사 먼저). D단계 `/v2/read/*`와 같은 처리 함수(`serverCall`)를 쓴다. 로그인 없으면 401(배포 후 확인).
- 배포: 묶음 SHA-256 `9adafe269980b01b0b9dc43e8ff4fdf06d428698e78ca971646947137280d198`(86,946바이트).

## 3. 검증

| 범위 | 결과 |
|---|---|
| 로컬 PostgreSQL 17(도커, 네트워크 없음) | 99개 통과(기존 88 + 동기화 11: 한 번 적용·검사, 첫 받기 복사, 보내기·받기, 재전송, 충돌 시 전부 미적용, 만들기·지우기·다시 만들기, 검사 16종, 그림 참조·신고·문지기, 쪽 나누기·한도, 4기기 동시 보내기 = 1건만, 되돌리기 거절·복원) — `evidence/migration-sync-workspace-pass.json` |
| 개발 서버 적용 | `evidence/migration-dev-workspace-sync-install.json` — 검사 전부 참 |
| 실서버(가상 계정·가상 일지, `WJB_LIVE_C3=1`) | 16개 통과(기존 C-3·D 10 + 동기화 6: 첫 받기 비어 있음, 보내기·재전송, 늦은 기기 충돌, 받기, 새 그림 신고·예약·올리기·참조, 인라인 그림 거절). 끝난 뒤 서버 개수 = 시험 전 — `evidence/preview-dev-c3-engine-live.json` |
| 단위 | `sync-rpc.test.mjs`(모양·코드 대응), 적용 도구 안전 시험 23개 |

- 실서버 시험의 정리 확인은 "시험 전 개수와 같음"으로 바꿨다. 사용자가 상호 확인 때 만든 공간 2개(계정 `c4bc20ee`)가 개발 서버에 있어 "0개" 기준이 맞지 않았다 — 그 자료는 건드리지 않았다.
- 개발 자료 정리 도구(`dev-copy-admin.mjs --purge-owner-development`)는 `wjb_sync` 행을 먼저 지운다.

## 4. 알려진 점 · 다음
- 신고 없이 예약하면 gateway가 `METADATA_UNAVAILABLE`로 거절한다(문지기 오류를 일반 오류로 보여 줌). 앱은 늘 신고부터 하므로 동작에는 문제가 없고, 코드 다듬기는 후속.
- 지움 표시는 지금 영구 보관(보관 한도·압축은 G단계).
- 다음 E-3: 이 기기 대기열 → 기록 사상(행 단위) → push / pull 적용(`applying`) / 충돌 보존·목록 창, E-4 새 그림 올리기 연결, E-5 상단 상태·실기.
