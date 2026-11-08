# 38. 미확정 저장의 복구 worker·운영자 검토 계약

2026-11-08 · `v2-design` · 실제 Supabase 변경 없음

## 이번 진행

사용자의 커밋/푸시 후 다음 단계 요청으로 `96d6899`의 원격 반영을 확인한 뒤, [recovery worker](../../poc/v2-gateway/recovery.mjs)와 [SQL catalog/처리 기록](../../poc/v2-gateway/recovery.sql)을 추가했다. 적용한 앱 UI나 자동 운영 cron은 없으며, 명시적으로 호출하는 로컬 PoC다.

**최종 결과:** 복구 단위25개·metadata adapter14개·기존 HTTP61개·영속/복구 통합41개가 통과했다([증거](evidence/recovery-worker-pass.json), [통합 로그](evidence/recovery-worker-durable-pass.txt)). 통합41개에는 앞 단계25개와 새 복구16개가 포함된다. 실제 gateway/복구 프로세스를 사용하고 SQL은 실제 PostgreSQL이지만, Auth/REST/Storage 서비스 자체는 로컬 대체 구현이다.

## 자동 추측 대신 검토 가능한 계획

`preview`는 권한 있는 사용자의 공간을 최대8개 자산씩 읽는다. 원래 lease token·사용자 토큰·본문은 결과에 넣지 않는다. 현재 작업 중/이전 generation/처리 완료 자료는 파일을 읽지 않는다. 그 외에는 최대64KiB의 객체를 읽어 예상 bytes/hash를 확인한다. 한 page의 파일 읽기는 최대512KiB이며 전체 목록을 자동 순회하지 않는다. 다음 cursor로 별도 조회한다.

| 현재 상태와 관측 | 제안 | 실제 실행 |
|---|---|---|
| reserved, 파일 크기/hash 일치 | 복구 가능 | 확인 후 ready. 미확정 intent가 있어도 그대로 보존하고 quota 유지 |
| reserved/cleanup, 미확정 intent 없음, 파일 없음 또는 정상 | 정리 가능 | 확인 후 cleanup→삭제/부재 재확인→canceled·quota 반환 |
| 파일 없음, 미확정 intent 있음 | 확인 보류 | 객체가 없다는 이유로 완료/취소하지 않음 |
| cleanup, 미확정 intent 있음 | 확인 보류 | 파일이 있어도 사용자 취소 의도를 뒤집어 ready로 복구하지 않음 |
| 크기/hash 불일치·저장소 오류 | 수동 검토/재조회 | 삭제·덮어쓰기·상태 확정 없음 |
| 다른 generation·진행 중 lease·ready/canceled | 보류/처리 완료 | 변경 제안 없음 |

preview는 metadata/Storage를 바꾸지 않는다. `apply`에는 선택한 작업과 해당 계획의 검토 hash가 필요하다. 검토 유효기간은 PoC60초이고 제품 정책 확정값은 아니다. hash는 계획/선택의 일치 확인용이며 비밀·인증 키·서명이 아니다. 실제 권한은 현재 JWT/세션·device·공간 소유권 검증으로 결정한다.

실행 직전에 catalog와 파일을 다시 읽고, metadata 상태/IO version/기대 hash·크기/generation이 달라졌거나 파일 관측이 바뀌면 RECOVERY_CHANGED로 중단한다. recovery lease로 fence를 새로 얻고 SQL도 최종 조건을 확인한다. 계획의 action을 임의로 바꿔도 현재 분류/SQL 조건을 통과해야 하며 미확정 I/O를 강제로 없애는 옵션은 제공하지 않는다.

## 새 기기와 감사 기록

유효한 새 기기의 같은 개인 계정도 잃어버린 기존 기기가 만든 자산을 복구할 수 있다. 일반 upload/cancel의 creator binding은 유지하고, recovery mode만 현재 소유자의 유효한 device/session을 허용한다. workspace owner/generation 검증을 생략하지 않는다. 팀 협업/타인 자료 복구 권한으로 확대하지 않는다.

복구 ready·복구 취소/용량 반환과 `recovery_audit` 기록은 같은 SQL 명령의 트랜잭션에 속한다. 기록에는 decision ID·계획 hash·actor/device·IO version·작업/결과/시각을 남기며 본문/키는 넣지 않는다. 기록 실패 시 해당 상태/용량 변경도 rollback된다. 파일 삭제처럼 별도 Storage 작업은 되돌릴 수 없으므로 그 경우 metadata는 cleanup·quota 유지로 남고 새 계획으로 재개한다.

완료 기록이 같은 decision/계획/action에 해당하면 ALREADY_APPLIED를 반환한다. 응답 유실/프로세스 재시작 뒤에도 같은 작업을 다시 삭제하거나 용량을 중복 차감하지 않는다. 기록은 server-only 경계에 있으며 앱/anon 역할에 직접 table/RPC 권한을 열지 않았다. 관리자까지 조작할 수 없는 외부 감사 시스템을 구현한 것은 아니다.

## 운영자 화면 계약 — 아직 앱 UI 미구현

기본 행은 **업무/자산 식별 · 파일 크기 · 상태 · 예약 용량 · 가능한 작업**으로 구성한다. lease/fence/SQL 이름은 기본 화면에 표시하지 않는다.

- **복구 가능:** ‘파일 검증 완료’와 ‘미확정 저장 N건’을 표시하고 [복구]를 제공한다. 미확정 저장이 있으면 [정리]는 제공하지 않는다.
- **정리 가능:** 해제할 예약 용량과 대상을 검토한 뒤 [정리]를 제공한다. 기존 ready 파일이나 다른 generation의 자료에는 제공하지 않는다.
- **확인 보류:** 이유와 [다시 조회]만 제공한다. ‘강제 해제’·‘무시하고 진행’은 없다.
- **처리 완료:** 완료 결과를 보여주고 작업 버튼을 제거한다. 같은 요청 재전송은 기존 결과를 보여준다.
- **계획 만료/상태 변경:** 다시 조회하도록 안내한다. 최신 상태로 조용히 범위를 바꿔 적용하지 않는다.

기본 동작은 미리보기다. 사용자가 해당 행의 복구/정리를 선택한 경우에만 apply를 호출한다. 현재 검증 인터페이스는 로컬 IPC/함수이고 앱의 버튼·창·번역 리소스/가이드를 바꾸지 않았다.

## 실행 증거와 실제 시험

가상 ES256 토큰→세션 확인 HTTP RPC→실제 SQL catalog/명령→Storage 형태 서버로 연결했다. 다음을 확인했다.

| 상황 | 결과 |
|---|---|
| 객체 저장 후 gateway SIGKILL | matching bytes를 ready로 복구, 기존 미확정 intent1건은 그대로, quota 유지 |
| intent 기록 후 저장 전 SIGKILL | 파일이 없어도 UNCERTAIN_IO 보류, 임의 용량 반환 없음 |
| 정상 미완료 예약 정리 | 부재 확인 후 canceled와 audit/용량을 함께 commit |
| 오래된 계획·다른 IO version·파일 관측 변경 | 실행 거절, 새 조회 필요 |
| 현재 세션 logout/다른 계정 | 복구 catalog/apply 접근 거절 |
| 원래 기기 회수 후 같은 계정의 새 기기 | 복구 성공, actor는 새 기기로 기록 |
| 만료된 업로드 예약 | 별도 recovery mode로 정상 파일 검토/복구, 과거 upload lease를 되살리지 않음 |
| audit INSERT 실패 | 상태/용량 차감 rollback. cleanup 상태에서 새 계획으로 재시도 |
| 완료 후 gateway 재시작/요청 반복 | 기존 완료 기록 반환, 중복 용량 차감 없음 |
| 복구 worker가 삭제 직후 SIGKILL | cleanup/quota 유지. 이전 계획 거절, 새 미리보기 후 정리 완료 |
| catalog page/큰 카운터 | page8개 제한/cursor와 정확한 bigint 문자열 처리 |

통합은 기존의 고정 PostgreSQL17 이미지·전용 volume·두 gateway 프로세스/127.0.0.1 서버를 사용한다. 시험 종료 시 자기 label의 컨테이너/volume만 제거한다. lease 만료는 pause/종료를 확인한 뒤 시간을 앞당기는 fixture이고 실제 TTL 대기/성능 보장이 아니다. 전원 장애·실제 Storage 내구성/정책·managed Auth와의 통합을 검증하지 않았다.

## 유지하는 제한과 다음 단계

**파일이 없고 저장 완료 증거도 없는 intent는 이번에도 해제하지 않는다.** provider의 권위 있는 완료 증거/중단 보장 없이 timeout·여러 번404·운영자 체크박스만으로 안전해졌다고 간주하지 않는다. 이 보류가 오래 지속될 수 있고 예약 용량도 남는다. matching 객체를 ready로 복구할 수 있는 경우와 불확실한 정리 중단을 구분한다.

SQL은 기존 `wjb_gateway` 후보에 recovery mode/audit/catalog를 더한 별도 검토본이다. 앞 단계의 C1 적용안이 이를 포함한 것은 아니다. 실제 적용 전에 metadata/recovery까지 포함한 명시적 migration·권한·되돌리기 목록과 대상 스키마/Storage 정책·Usage를 확인해야 한다. prototype의 높은 권한 migration 소유자도 별도 검토한다.

새 dependency·제품 소스/DB18·main·배포·환경 게시·준비 true flag는 변경하지 않았다. 다음은 **전체 metadata/recovery 적용·권한·되돌리기 묶음 정리 및 실제 프로젝트 읽기 점검**이다. 소규모 cloud 시험은 그 범위를 검토한 후 진행한다.
