# 58. 이관 journal 영속화·재개·취소·응답 유실 복구

2026-11-10 KST · v2-design · 합성 데이터/로컬 SQLite + 테스트용 서버 어댑터. 실제 Supabase 이관 RPC/제품 연결은 아직 아니다.

## 구현 결과

[journal.mjs](../../poc/v2-migration/journal.mjs)에 새 온라인 사본의 이관 작업을 영속 저장하고, [coordinator.mjs](../../poc/v2-migration/coordinator.mjs)에 업로드/상태 재조회/연결 확정/취소 정리를 연결했다. 56문서의 **로컬 영구 지원·원본 불변·새 온라인 공간 생성·온라인 DB/Blob 이중 본문 저장 금지**를 유지한다.

journal은 제품 DB18과 다른 application_id/user_version을 가진 독립 SQLite 파일이다. job/asset 두 테이블에는 작업/계정/기기/새 공간 ID·source/manifest hash·실물 크기·진행 상태·작업 ID·lease/fence/epoch만 저장한다. 이미지 binary/base64/data URL·사용자 본문·JWT/refresh token·원본 경로·오류 응답은 저장하지 않는다. bytes 필드는 정수 크기이지 이미지 bytes가 아니다. 모든 인벤토리는 검증한 온라인 사본에서 만들고 원본을 다시 스캔해 이후 편집분을 자동 포함하지 않는다.

생성/재개는 .v2-poc-only 가상 폴더로 제한한다. 기존 DB18을 journal로 여는 요청은 읽기 전용 식별 검사 후 거절한다. journal 생성 위치는 보호할 로컬 원본 폴더와 겹치면 안 되며 symlink/hardlink alias도 거절한다. 제품에서는 동일 경계를 Platform/Rust의 canonical path/파일 소유권 가드로 이행해야 한다.

## 상태와 재개 규칙

```text
prepared → uploading → publishing → connected
    └───────── 취소 요청 ────────→ cancel_requested
                                      ↓ 서버 취소 경계 확인
                                 cancel_fenced → canceled
```

| 자산 상태 | 의미/재개 처리 |
|---|---|
|pending|아직 전송 확정 없음. 사본 hash/bytes 검증 후 시작 |
|uncertain|원격 요청 전에 intent를 커밋했으며 결과 미확정. 원격 재조회가 우선 |
|verified|해당 작업 소유의 실물 hash/bytes·I/O 종료를 확인 |
|delete_uncertain|삭제 요청 전 intent를 기록, 부재와 I/O 종료 확인 대기 |
|deleted|취소 경계 아래에서 작업 소유 실물의 부재/종료 확인 |

SQLite journal_mode=DELETE/synchronous=FULL과 짧은 트랜잭션으로 네트워크 요청 **전에** intent를 커밋한다. 네트워크 대기 중 DB 트랜잭션을 잡지 않는다. 서버 작업 ID는 재조회에 재사용하며, 최종 연결 요청 ID도 publishing 상태에 남긴다. asset 작업 단위는 추출된 실물 Blob이고 논리 객체 수와 같다고 가정하지 않는다.

30초 lease·증가 fence와 취소 epoch를 사용한다. 두 연결의 중복 실행/만료된 worker의 늦은 응답을 거절하며, 취소는 기존 worker의 완료 기록 권한을 무효화한다. lease 만료가 실제 원격 I/O 종료를 뜻하지는 않는다.

## 원격 어댑터 계약과 안전 조건

현재 어댑터는 테스트용이다. 고정 Supabase 대상/인증·RLS·실제 서버 영속 테이블/RPC 구현은 후속 단계다. 클라이언트가 임의 URL/자격증명/서버 완료 JSON을 지정하는 API를 만들지 않았다.

| port | 요구되는 서버 의미 |
|---|---|
|upload|새 공간/작업 소유 경로에 immutable 전송. 취소 경계 이후 요청 거절 |
|observe|job/object/manifest/operation ID에 일치하는 결과, 실물 hash/크기·소유권과 operationSettled 확인 |
|stageMetadata|매핑한 참조형 문서를 hidden staging에 멱등 반영. imagePayloadRows=0 검증 |
|publish/publication|같은 작업/manifest의 원자적 전체 검증·연결 확정 및 결과 재조회 |
|cancelStaging|publish와 원자적으로 경쟁. 이미 connected면 취소 거절, 아니면 이후 연결/전송 차단 경계 확정 |
|remove/finishCancel|해당 이관이 소유한 실물만 삭제하고 부재/미확정 I/O0을 검증한 뒤 취소 완료 |

**operationSettled=true는 Storage HEAD/GET에서 파일이 없다는 뜻이 아니다.** 서버의 I/O intent·완료/차단 근거가 필요하다. timeout·취소된 HTTP 요청·lease 만료를 근거로 true를 만들면 안 된다. 부재라도 늦은 upload가 가능하면 uncertain 상태로 남기고 재전송/취소 완료를 하지 않는다. 오래된 operation ID의 관측도 현재 작업을 확정할 수 없다.

최종 연결 응답 유실 후에는 publication을 먼저 조회한다. 이미 연결됐다면 같은 작업을 다시 게시하지 않고 그 결과를 수용한다. pending/미확정이면 대기하며, 이전 작업이 종료됐고 미게시가 확인된 경우에만 같은 요청 ID로 재시도한다. 다른 workspace/manifest의 receipt는 거절한다.

취소는 로컬 cancel_requested 기록만으로 삭제하지 않는다. 서버의 job/manifest/epoch와 publishBlocked를 확인한 뒤 cancel_fenced로 진행한다. 이미 연결이 commit됐다면 파일을 삭제하지 않고 연결 결과를 재확인한다. delete 성공 응답만으로도 완료하지 않고 부재와 작업 종료를 다시 확인한다.

취소/최종 게시 재조회는 로컬 staging 파일이 없어도 journal의 영속 scope와 서버 확인으로 진행할 수 있다. 반면 새 업로드는 정확한 사본/manifest와 실물 검증이 필요하다. journal의 connected는 이관 이력이고, 현재 세션/온라인 공간 접근 권한이나 로컬 cache 정상 여부를 대신하지 않는다. 앱 실행은57문서의 서버 검증/저장 어댑터 경계를 계속 거친다.

## 시험 결과

[coordinator.test.mjs](../../poc/v2-migration/coordinator.test.mjs)의 **신규32개**가 통과했다. 테스트용 서버 상태/bytes는 메모리에 있으며 실제 클라우드 통신은 없다.

- DB 닫기/재열기 후 업로드 응답 유실·재조회·재시도, 게시 응답 유실·중복 게시 방지.
- 미확정 I/O에서 보수적으로 대기, 다른 계정/기기/작업·hash/소유권/receipt 거절.
- 취소 전 서버 차단 경계, 이미 게시된 공간 취소 거절, 삭제 응답 유실/실물 잔류 확인.
- 두 SQLite 연결의 lease 충돌·늦은 worker 거절, 전송/metadata staging 중 취소 경쟁.
- **Linux 자식 프로세스 SIGKILL** 뒤 uncertain intent 유지/새 lease 획득. 실제 Cloud 전송 중 강제 종료 시험은 아님.
- 원본/새 사본 파일 보존, 원본 폴더 journal 생성 거절, DB18 오인식/alias 거절.
- 사본 파일 유실 후 취소/기게시 결과 재조회, 원본의 이후 정상 편집을 수집하지 않음.
- journal 파일의 원본 이미지 binary/base64 부재와 BLOB 컬럼 없음 확인.

회귀는 격리29개+사본 추출23개+DB18 보존19개로71개이며 이번 단계 총 **103개 통과**. [증거](evidence/migration-journal-pass.json)에 로그/소스 hash와 검증 한계를 기록했다. 기존 실제 Storage47개는 이번에 재실행/합산하지 않는다.

```sh
node poc/v2-migration/coordinator.test.mjs
node poc/v2-runtime/isolation.test.mjs
node poc/v2-assets/connected-copy.test.mjs
node poc/v2-sync/db18.test.mjs
```

## 다음 단계와 제한

1. 위 서버 port의 영속 PostgreSQL 이관 테이블/RPC를 구현·로컬 PostgreSQL에서 검증한다. 실제 cancel/publish 원자성·I/O 종료/권한·완료 증표를 서버에서 입증해야 한다.
2. 추출 records를 서버 도메인 명령으로 매핑하고 기기 설정/경로 제외·문서/소유권/이미지 참조·본문0건 검증을 붙인다. 현재 보존용 SQLite 전체를 서버에 올리지 않는다.
3. 새로운 전진 SQL/ACL/rollback/비용 범위를 검토한 뒤 개발 Supabase 통합 시험으로 이어간다. 기존 install.sql을 재실행하지 않는다. 제품용 이미지의64KiB 초과 한도/화질 정책은 별도 검토다.
4. native 앱/설정·업데이트 분리, Win/macOS 파일/잠금/디스크 부족·전원 장애 검증과 UI 연결을 완료한 뒤 제품 이관을 활성화한다.

현재 journal은 PoC 버전1이고 완성된 운영 감사 이력/보관 정책·실제 파일 전송 스케줄러/백그라운드 서비스는 아니다. 실제 원본 DB/제품/src-tauri/워크플로/설정/Cloud/유료 서비스는 변경하지 않았다. 로컬 모델은 계속 영구 지원 대상이다.

## 후속 서버 구현

[59문서](59-postgres-migration-server.md)에서 실제 PostgreSQL의 이관 테이블/RPC·ticket/fence·취소/I/O·권한/rollback39개를 검증했다. 현재 최소문서프로필이며 전체DB18mapper/실제gateway port는 미연결이다. 이 문서의 테스트용remote와 구분하고source/targetmanifest를 각각 바인딩해 후속 연결해야 한다. 실제Cloud는 미적용이다.
