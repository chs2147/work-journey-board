# 82. C-1 — 기록 페이지 업로드·이미지 10MB·앱용 gateway 경로 (개발 서버 적용·실서버 검증 완료)

2026-11-15 · `v2-design` · [81문서](81-c-stage-copy-design.md) C-1의 앞부분 · 사용자 승인(81문서 4절 개발 서버 변경 3건 — 적용은 C-1b와 함께)

## 0. 한눈에

| 항목 | 결과 |
|---|---|
| 새 전진 SQL | `010-workspace-paged-upload.sql`(적용) · `012-…-verify.sql`(점검) · `011-…-rollback-empty.sql`(빈 상태 되돌리기). 생성기 `build-workspace-sql.py`, **001·004·007은 바이트 그대로** |
| 기록 한도 | 공간당 **2,048 → 20,000행**, 봉투 1MiB → 64MiB, 표별 4,096 → 20,000 |
| 나눠 보내기 | 머리(기록 없는 봉투) → **페이지(≤1,000행)** 최대 32개 → 받은 페이지 조회(끊긴 뒤 빠진 것만) → 서버가 조립해 **기존 시작 처리 그대로** → 페이지 삭제 |
| 성능 | 참조(FK) 검사를 기록마다 전체를 훑던 방식(행 수²)에서 **해시 조인 한 번**으로. 5,052행 검증 1.3초 · 19,952행(약 9MB) 4.5초 — 행 수에 비례 |
| 이미지 | 아직 8개·개당 64KiB(C-1b에서 Storage 직접 업로드로) |
| 시험 | 로컬 PostgreSQL 17.11 **115 통과**(기존 108 + 새 7) · 서버 RPC 19(새 3) · V2 회귀 341 |

## 1. 구조

- 기존 공개 명령 본문은 **바꾸지 않고** `wjb_migration.command_core`로 옮겼다(비공개, 실행 권한 없음). 공개 `wjb_v2_migration_command`는 새 4개 명령(`upload_begin`·`upload_page`·`upload_status`·`start_upload`)만 직접 처리하고 나머지는 그대로 넘긴다.
- 새 테이블 `wjb_migration.upload`·`upload_page`: RLS 켜짐, 모든 역할 직접 접근 없음. 소유자·기기·세션 확인은 기존과 같다(다른 계정은 업로드를 보지도·더하지도·시작하지도 못함).
- 같은 순번에 다른 내용 = `MIGRATION_PAGE_CHANGED`, 머리 바뀜 = `MIGRATION_IDEMPOTENCY_MISMATCH`, 빠진 페이지 = `MIGRATION_UPLOAD_INCOMPLETE`. 시작 뒤 다시 부르면 같은 작업(재시도 안전).
- 페이지 해시는 **서버 RPC 계층(`server-rpc.mjs`)이 받은 기록으로 계산**해 넘긴다(앱이 보낸 해시를 믿지 않음). SQL은 같은 순번 내용 비교로 변경을 거절한다.
- 조립된 봉투는 기존 검증(`normalize_workspace`)을 그대로 지난다 — FK·그림 참조·잠금·칸반 규칙 등 오류 코드 동일(시험: 없는 업무를 가리키는 기록 → `MIGRATION_FOREIGN_KEY`, 작업 생기지 않음).
- 큰 일지 시험 자료: `emit-workspace-fixture.mjs 20 --extra-items N`(가상 기록 N개 복제, 실제 업무 기록 아님).

## 2. 시험(로컬 PostgreSQL, 새 7개)

010 한 번만 적용 · 012 권한/RLS 점검 + 011 되돌리기 후 004 명령·007 검증 함수 원문 그대로 · 단일 요청 시작 회귀 · **5,052행 6페이지 업로드 → 시작 → 손실 없이 다시 읽기**(업로드 1.1초·시작 1.5초·읽기 1.2초) · 끊긴 업로드 이어서(빠진 페이지만)·변경 페이지/범위 밖/머리 변경 거절 · 다른 계정·클라이언트 역할 거절 · 한도(20,001행·기록 포함 머리)와 FK 검증 유지. [증거](evidence/migration-paged-upload-pass.json)

## 3. 개발 DB 적용 준비

- 검토 manifest `poc/v2-migration/postgres/paged-upload-review-manifest.json`(010·012·011 해시 고정, `autoApply: false`)
- 적용 도구 `poc/v2-migration/development/paged-apply.mjs --apply-010-development --free-usage-confirmed` — 007 있음·010 없음 확인 → 한 번 적용(응답 유실 시 재적용 없이 읽기 확인) → 012 점검 → 증거. 안전장치 시험(명시 실행·운영 거절·비밀값 없으면 요청 전 중단) 추가.
- **아직 적용하지 않았다.** 81문서 계획대로 C-1b(이미지)까지 로컬에서 끝낸 뒤 개발 DB 적용·버킷·gateway 재배포를 한 번에 한다.

## 4. 남은 C-1b

1. 이미지 한도 확장: 이관 자산 8 → 2,000개, 개당 64KiB → 10MB, 공간 합계 200MB — `wjb_migration.asset` 크기 제약, gateway 저장 모듈(`wjb_gateway`)의 예약·할당량
2. Storage **서명 업로드 주소** 발급 → 앱이 Storage에 직접 올림 → gateway가 받아 SHA-256·크기 재확인 → 정산(취소 울타리·부재 확인 그대로)
3. 앱이 부를 gateway HTTP 경로: 이관 명령(페이지 업로드 포함)·기기 등록 — 지금은 서버 안 시험 도구만 RPC를 부른다
4. 개발용 영구 private bucket `wjb-v2-dev-assets`
5. 개발 DB에 010(+C-1b SQL) 적용 → 실서버 검증

## 5. C-1b 결과 (2026-11-15)

| 항목 | 결과 |
|---|---|
| 010 확장(아직 어디에도 적용 전이라 010에 합침) | 이미지 **8 → 2,000개, 개당 64KiB → 10MB**(이관·gateway 저장 모듈 제약·예약 명령), 새 온라인 공간 할당량 **1MB → 200MB**, 서버 전용 **기기 등록 RPC** `wjb_v2_device_register`(자기 세션만·같은 기기 재등록 그대로·남의/폐기 기기 거절·사용자당 16대). 011은 64KiB 넘는 그림이 하나라도 있으면 되돌리지 않음 |
| gateway JS | 한도 상수 `MAX_ASSET_BYTES`(10MB) 한 곳(`io.mjs`) — 예약·본문 읽기·Storage 읽기/쓰기·메타데이터 행 검사·복구 작업자. 그림 본문 읽기 120초(느린 회선, Edge 무료 실행 150초 안). 버킷 이름 설정화 |
| 앱용 Edge 경로 | `POST /v2/devices`(기기 등록) · `POST /v2/migrations/{작업}/{명령}`(앱이 불러도 되는 명령만: 페이지 업로드 4종·상태·읽기·게시·취소 등) · `attest`(서버가 Storage에서 바이트를 다시 읽어 해시·크기 확인 후) · `confirm-absent`(서버가 부재 확인 후). 사용자 토큰 → 서버 확인 → 서버 전용 RPC, 본문에서 계정·세션을 받지 않음. 그림 바이트는 기존 검증된 gateway 경로(`…/assets/{id}/content`·`cancel`) |
| 설계 조정 | 81문서의 “Storage 서명 주소 직접 업로드” 대신 **검증된 gateway 경로 + 한도 상향**. 서명 주소는 취소 울타리·입출력 정산 규칙을 새로 짜야 해서(취소 뒤 늦게 도착하는 업로드) 위험이 크고, 10MB는 Edge 메모리로 충분. 서버가 바이트를 다시 읽어 확인하는 점은 같다 |
| 개발 서버 적용(승인 3건) | ① 010 적용·012 점검 통과([증거](evidence/migration-dev-paged-upload-install.json)) ② 영구 비공개 버킷 `wjb-v2-dev-assets`(10MB·`application/octet-stream`·비공개, [증거](evidence/preview-dev-bucket.json)) ③ gateway v5~ 재배포 |
| **실서버 HTTP 검증** | `live-paged-copy.mjs` — 앱처럼 Edge gateway HTTP만: 인증번호 로그인 → 기기 등록 → **5,052행 6페이지**(1페이지 빼고 보냄 → 상태가 빠진 페이지 알려 줌 → 다시 보냄) → 시작 → **512KB 그림**(예전 한도 초과) 업로드·서버 확인 → 토큰 없는 읽기 401 → 게시(`poc-verified`) → 5,052행 다시 읽기 → 그림 내려받기 해시 일치 → 두 번째 작업 취소·부재 확인·할당량 0. **10검사 모두 통과, 정리 후 작업·업로드·기록·공간·그림·기기·객체·시험 계정 0.** 시간: 기록 13.7초·그림 7.3초·읽기 4.8초. [증거](evidence/preview-dev-paged-copy-live.json) |
| 고친 결함 | `server-rpc.mjs`가 Node 전역 `Buffer`를 가져오지 않고 써서 Deno(Edge)에서만 실패 → `node:buffer` 가져오기. 메타데이터 어댑터·복구 작업자의 64KiB 행 검사 → 공용 상수 |
| 시험 | 로컬 PostgreSQL 117(새 2: 5MB 예약·10MB 초과 거절, 기기 등록) · V2 회귀 444 |

### 한계·다음

- 이 작업 환경은 프록시 업로드가 초당 약 32KB라 5MB 실전송은 시간 안에 못 해 512KB로 검증했다. 5MB 예약·10MB 초과 거절은 로컬 PostgreSQL로 확인. **실제 5~10MB 전송은 Preview 실기에서 확인**한다.
- 다시 읽기 검사는 기록 수(5,052)와 내용 비교. 그림은 해시 일치.
- 공간 할당량 200MB 초과·그림 2,000장 상한의 실서버 경계 시험은 하지 않았다(로컬 SQL 규칙).
- 다음 = **C-2 원본 읽기**(Preview가 로컬 일지를 읽기만 해서 임시 사본) → C-3 이관 엔진 → C-4 화면.
