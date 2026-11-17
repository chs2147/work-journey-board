# 100. G-5 데이터 수명 — 공간 서버에서 지우기 · 안 쓰는 그림 정리 · 계정 삭제

2026-11-17 · 브랜치 `v2-g-stage` · 97문서 G-5 · 결정 G-D4(①②④ 먼저, ③ 지움 표시 정리는 측정 뒤)

## 0. 원칙

- 기존 SQL 함수·테이블은 바꾸지 않는다(새 스키마 `wjb_life` + 새 서버 함수 둘, 전진 전용 031·확인 032·되돌리기 033).
- **기록은 바로, 그림 실물은 뒤에서.** 지우면 기록·동기화 표·사용량은 한 묶음으로 바로 지우고, 그림은 `cleanup`으로 넘긴 뒤 gateway 작업자가 저장소에서 지우고 **없는 것을 확인한 뒤에만** 용량을 돌려준다(기존 이관 취소와 같은 규칙).
- 이 기기 사본은 서버가 건드리지 않는다. 지운 기기는 자기 사본을 지우고, 다른 기기는 목록에서 사라지고 열린 상태면 알약이 "서버에서 지워진 공간"(이 기기 사본은 그대로).
- 관리자 계정은 지울 수 없다(고정, 96 Q2와 같음). 이 PC(로컬) 공간은 어떤 경우에도 그대로.

## 1. 서버(SQL 031)

| 대상 | 내용 |
|---|---|
| `wjb_life.purge` | 지우는 중·지운 공간(이유 `space`·`account`, 요청한 사람, `done_at` = 그림 실물까지 끝) |
| `wjb_life.orphan` | 참조 없는 그림(`since`, `released`) |
| `wjb_life.account_gone` | 지운 계정(gateway가 Auth 사용자를 지운 뒤 `auth_deleted_at`) |
| `purge_space` | 이관 일감 `canceled`(목록·읽기·동기화에서 바로 사라짐 → 다른 기기 `*_NOT_FOUND`) → 동기화 기록·적용 기록·그림 신고·동기화 공간·게시 기록·머리·사용량 캐시 줄 삭제 → 그림 `cleanup` |
| `sweep_orphans(시각)` | 동기화한 적 있고 지우는 중이 아닌 공간의 `ready` 그림 중 지금 기록(`dataRef`·`thumbRef`)이 참조하지 않는 것을 표시. 새로 올린 그림은 신고 뒤 **7일**이 지나야 대상, 표시 뒤 **7일** 더 지나도 참조 없으면 `cleanup`. 그 사이 다시 참조되면 표시를 뗌 |
| `wjb_v2_lifecycle` | 사용자(세션·기기 확인): `delete_space {workspaceId}`(소유자만 — 남의 것은 `LIFE_NOT_FOUND`), `delete_account {}`(나) · `{userId}`(관리자만, 관리자 대상은 `ACCOUNT_ADMIN_FIXED`) — 공간 모두 지우기 + 기기 막기 + 한도 줄 삭제 + Auth 삭제 대기 |
| `wjb_v2_lifecycle_worker` | gateway 작업자만: `next {limit≤50}`(임대·진행 중 입출력 없는 것만, 다 끝난 공간 `done_at`) · `confirm`(같은 io 판일 때만 `canceled` + 용량 반환, 0 아래로 내려가지 않음) · `sweep` · `auth_pending` · `auth_deleted` |
| 권한 | 두 함수 모두 service role만, `search_path=pg_catalog`, `wjb_life` 스키마는 API 역할 접근 없음 |
| 예약 | `pg_cron` `wjb-life-sweep` 매일 18:10 UTC(03:10 KST) — SQL만(표시·넘기기) |
| 되돌리기 | 033은 031로 지운 것이 하나라도 있으면 거절(`MIGRATION_031_IN_USE`) — 지운 공간은 되돌릴 수 없으므로 |

로컬 PostgreSQL 17: 기존 110 + 031 5 = **115 통과**(`evidence/migration-g5-lifecycle-pass.json`). 개발 프로젝트 적용·확인·예약(`evidence/migration-dev-lifecycle-install.json`).

## 2. gateway(v16)

- `poc/v2-migration/lifecycle-rpc.mjs`: 사용자 호출·작업자 호출·Auth 사용자 지우기(관리 API, 404 = 이미 없음), `runPurge`(시간 예산 안에서 `next` → `storage.remove`(지운 뒤 없는 것 확인) → `confirm`, 실패한 것은 다음 차례 · `auth_pending` → 지우기 → `auth_deleted`).
- 경로 `POST /v2/lifecycle/{delete_space,delete_account}`(로그인 필요). 응답 뒤 `EdgeRuntime.waitUntil`로 정리(8초). `/v2/account/usage` 때도 뒤에서 정리(4초) — 따로 비밀·예약 호출 없이 쓰는 동안 조금씩.
- 개발 서버 배포 v16(2026-11-17): 로그인 없이 `/v2/lifecycle/delete_space` → 401, `/v2/lifecycle/sweep` → 404(사용자 경로 아님).

## 3. 앱

| 자리 | 동작 |
|---|---|
| 설정 › 워크스페이스(온라인 목록) | 줄마다 [서버에서 지우기…] — 지금 연 공간은 누를 수 없음(다른 공간으로 바꾼 뒤). 확인 줄에 공간 이름을 그대로 입력해야 [서버에서 지우기]. 지우면 이 기기 사본도 지우고 목록·사용량 새로 |
| 설정 › 계정(로그인) | 일반 계정만 [계정 삭제…] — 이메일 입력 확인 → 이 기기의 온라인 사본 지움 → 로그아웃(온라인 공간을 연 동안이면 보내고 닫은 뒤). 이 PC 공간은 그대로 |
| 관리 카드 | 관리자 줄 말고 [계정 삭제…] — 이메일 입력 확인 → 목록 새로 |
| 다른 기기 | 열린 공간이 서버에서 지워지면 알약 "서버에서 지워진 공간입니다 · 이 기기에 저장됨"(`SYNC_NOT_FOUND`) |
| Rust | 새 명령 없음 — `online_account_call`이 `delete_space`·`delete_account`만 `/v2/lifecycle/`로(그 밖 거절, 시험) |

시험: E2E `tests/e2e/lifecycle.spec.ts` 3(이름 입력·지금 연 공간 막힘·목록·사용량, 내 계정 삭제·관리자 버튼 없음, 관리자의 계정 삭제), Node `lifecycle-rpc.test.mjs` 4, Rust 경로 시험 1. 실기 = m1-check 7-54.

## 4. 알려 둘 것

- 7일 넘게 오프라인이던 기기가 지운 그림을 다시 쓰는 기록(되돌리기 등)을 보내면 서버가 받지 않는다(`SYNC_ASSET_NOT_READY`). ③ 지움 표시 정리와 함께 측정 뒤 다룬다.
- ~~계정을 지울 때 지금 연 공간의 이 기기 사본이 남음~~ → 고침(2026-11-17): 보내고 닫은 뒤 로그아웃 단계에서 그 사본도 지움.
- 운영 프로젝트에는 적용하지 않았다(G-2 절차서에 031 포함).
