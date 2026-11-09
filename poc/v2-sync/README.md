# V2 독립 로컬 동기화 모형

**저장 형식 주의(2026-11-10):** 이 폴더의 BLOB 포함 staging/local_assets/서버 모형은 과거 알고리즘·보존/왕복 시험용이다. 최종 온라인 DB로 배포/업로드하지 않는다. 온라인 DB/Blob 이미지 본문 이중 저장 금지와 로컬 영구 유지 원칙은 [56문서](../../docs/v2-design/56-local-permanence-copy-migration.md), metadata-only 추출 검증은 [v2-assets](../v2-assets/connected-copy.mjs)를 따른다.

Node 24.22.1에서 검증하는 첫 구현 증분이다. 제품 코드와 의존성을 공유하지 않는 ES module + Node 기본 SQLite/테스트 도구를 사용한다. TypeScript/Vitest 통합 전, 루트 설정/패키지를 바꾸지 않고 파일 DB 종료 시험을 재현하기 위한 선택이다.

```sh
node poc/v2-sync/model.test.mjs
```

직접 실행하면 세부 테스트 30개의 결과가 출력된다. `node --test`는 이 환경에서 파일 단위 결과로 집계하므로 세부 결과 보고에는 위 명령을 사용한다. 생성한 임시 폴더만 사용·정리하며 원격 요청은 하지 않는다. Linux SIGKILL 시험이며 Windows/macOS 파일 내구성 검증은 아니다.

구현: 파일 SQLite 트랜잭션, 편집/전송 대기 분리, 명령 해시·CAS·멱등 처리, 공간별 cursor, 충돌 사본, generation 기반 복원, scope 검사. 서버는 동일 프로세스의 SQLite 모형이며 실제 Supabase/Postgres가 아니다.

**24문서의 첫 구현 묶음은 아직 완료가 아니다.** 아래 테스트 성공을 L01~L08 전체 완료 또는 P01~P22 통과로 해석하지 않는다.

| 사례 | 이번 증거 | 아직 필요한 검증/구현 |
|---|---|---|
| L01 | 가상 모형 DB 복사·원본 byte hash·scope | 실제 DB18→V2 변환, 전체 F0 문서/이미지/링크 manifest |
| L02 | 편집/대기 batch 중·커밋 후 SIGKILL, 파일 재시작/무결성 | 제품 저장 어댑터 연결 |
| L03 | 응답 유실 뒤 재전송·해시 변조 거절·ack 뒤 추가 편집 보존 | 병렬 제출·재시작 가능한 전송 스케줄러·후속 대기 명령 재조정 |
| L04 | 수신 batch 중·커밋 후 SIGKILL, 파일 데이터/cursor 원자성 | 다중 페이지·중복/역순·cursor 만료 |
| L05 | 기준/내/서버 사본 보존·제3 revision 후 해결 거절·독립 항목 수락 | 실제 노트/보드 포맷·링크·충돌 해결 UI |
| L06 | 셀 전체 CAS가 오래된 삭제를 거절 | 항목 단위 수렴과 셀 구조 버전 분리·다중 셀 원자적 이동 |
| L07 | 복원 재시도 동일 결과·구 generation 거절·로컬 대기 보존 | 실제 manifest/자산·복원 전 사본 보존·재조정 |
| L08 | 계정/공간 scope 거절·늦은 응답 혼입 방지 | 실제 Auth 세션/기기 회수·RLS/Storage |

모형 입력은 가상 테스트가 만든 신뢰된 데이터다. 범용 문서 포맷/참조 검증기·클라우드 보안 경계·제품 migration이 아니다. DB 경로의 표시 파일 검사는 실수 방지용이며 제품의 파일 접근 정책을 대신하지 않는다.

## DB18 표본 전환 증분

`fixture18.mjs`는 기존 migration18개로 가상 DB18을 만든다. `db18.mjs`는 실험용 보존 포맷으로 전환·검증하고 새 DB18로 왕복 복원한다. 최종 V2 도메인 스키마로의 migration은 아니다.

```sh
node poc/v2-sync/db18.test.mjs
node poc/v2-sync/run-db18.mjs
```

추가19개 시험 결과와 재현/제약은 [26문서](../../docs/v2-design/26-db18-staging-results.md)를 따른다. 위 표의 L01 중 DB18 표본/문서·이미지·링크 manifest와 왕복 검증을 보완했으며, 최종 도메인 매핑은 남아 있다. 수집기는 새 임시 폴더에 원시 시험 로그와 JSON 증거를 보관한다. 자식 프로세스 실행 제한이 있으면 오류를 기록하고 실패로 종료한다.

## 전환본 연결과 영속 대기 증분

```sh
node poc/v2-sync/queue.test.mjs  # 신규28개
node poc/v2-sync/run-local.mjs   # 30+19+28개, 새 임시 폴더에 전체 증거 수집
```

`stage-import.mjs`는 DB18 전환본을 행 wrapper와 scope별 이미지 캐시로 옮긴다. `queue.mjs`는 초안/고정 명령·수신 cursor를 파일 DB에 보존하고 `tick`으로 진행한다. 큐는 기존 `edit/receive` 경로와 섞어서 호출하지 않는다. 타이머·실제 네트워크·제품의 도메인 검증기는 아니다. 새 시험은 직접 생성한 가상 DB만 사용한다.

상세 결과/다음 범위는 [27문서](../../docs/v2-design/27-durable-queue-results.md)를 따른다. 위 초기 표 중 L03의 기본 영속 대기/후속 편집 처리, L04의 페이지 중복·순서 누락, L05의 문서 사본 보존을 보완했다. 전체 사례 완료를 뜻하지 않는다.

## 셀 구조/내용 버전과 원자적 이동 증분

```sh
node poc/v2-sync/cells.test.mjs  # 신규38개
node poc/v2-sync/run-local.mjs   # 현재 30+19+28+38개 전체 증거
```

`cells.mjs`의 `applyCommand`는 patch-entry/move-subtree를, `receiveBatches`는 원자적 entry-batch 수신을 제공한다. 활성화한 workspace의 항목 쓰기는 범용 accept로 우회하지 않는다. 현재 tick/applyPage와의 자동 혼합 연결은 미구현이므로 별도 어댑터로 시험한다. 구 어댑터는 새 배치를 명시적으로 거절한다. [28문서](../../docs/v2-design/28-atomic-cell-move-results.md)에 시험 결과·수정 전 잠금 실패·제약을 기록했다.

## 통합 전송 경로

```sh
node poc/v2-sync/integrated.test.mjs  # 신규37개
node poc/v2-sync/run-local.mjs        # 현재 전체152개와 실행 증거 수집
```

`integrated.mjs`에서 항목은 enqueuePatch/enqueueMove, 노트 등 일반 문서는 기존 enqueue로 대기시킨 후 integratedTick으로 전송한다. applyMixed가 혼합 이벤트 페이지와 명령 완료 상태를 원자적으로 적용한다. 기존 tick/applyPage와 호출 경로를 혼용하지 않는다. 예전 entry_item 대기/이벤트를 자동 변환하지 않고 보존·거절하며, typed 이동은 workspace당 미해결1개로 제한한다.

[29문서](../../docs/v2-design/29-integrated-move-queue-results.md)에 검증 범위·수정 전 실패·제약을 기록했다. 현재 실험용 입력/SQLite 서버 모형이며 실제 앱/서버 인증·네트워크가 아니다.

## 로컬 체크포인트: 삭제·복원·장기 오프라인

```sh
node poc/v2-sync/lifecycle.test.mjs  # 삭제/문서+링크21개
node poc/v2-sync/recovery.test.mjs   # 복원/만료/GC/충돌/이동 의존성18개
node poc/v2-sync/completion.test.mjs # 변환/용량/SIGKILL/경합21개
node poc/v2-sync/stress.test.mjs     # F1/F2 기능/용량2개
node poc/v2-sync/run-local.mjs       # 현재 전체214개
```

[lifecycle.mjs](lifecycle.mjs)는 삭제/자식 생성·문서/링크 복합 명령을 처리한다. enqueueLifecycle로 대기시켜 integratedTick을 사용한다. [recovery.mjs](recovery.mjs)는 자산 포함 snapshot·복원 전 사본·cursor 보관 하한·명시적 아카이브/재동기화·보관 미리보기/GC를 제공한다.

충돌 선택은 resolveConflict, 연속 이동은 enqueueMoveAfter, 구 초안 변환은 upgradeLegacyDraft, 아카이브의 명시적 재입력은 recoverArchivedEdit을 사용한다. 모두 독립 모형의 API다. 자동 서버 복구·범용 SQL 동기화·실제 인증·UI를 제공하지 않는다. 삭제된 항목의 복구 사본은 로컬 검토용이며 자동 부활시키지 않는다.

[30문서](../../docs/v2-design/30-local-checkpoint-results.md)에 전체 결과·실행 증거와 대용량 메모리 한계를 기록했다. 단일 stress 시험은 10만 항목/50MiB 표본을 실제로 생성하므로 실행 중 임시 디스크와 메모리를 사용하고, 시험 종료 후 직접 만든 디렉터리를 정리한다. 원본 사용자 파일은 열지 않는다.
