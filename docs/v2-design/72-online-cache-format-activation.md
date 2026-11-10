# 72. 온라인 캐시 v1 형식·읽기 검증 어댑터

2026-11-10 UTC · v2-design · 앱 1.24.3 / 기존 로컬 DB19 유지

## 이번 단계의 결과

별도 온라인 SQLite 캐시의 **형식 초안 v1과 검증 구현**을 추가했다. DB18/19 원본을 수정하지 않고 이관된 metadata/Blob 참조를 캐시에 보관하며, 원격 확인과 일치할 때만 읽기 핸들을 반환한다. 로컬 캐시 검사 통과를 제품 편집·동기화 런타임의 승인으로 승격하지 않는다.

구현은 `poc/v2-runtime/online-cache.mjs`, `online-cache-activation.mjs`, `online-cache.test.mjs`다. 기존 `.v2-poc-only` guard를 유지한 **독립 Node 구현**이며 src/Tauri의 실제 저장소·UI에는 아직 연결하지 않았다. 기존 앱·DB migration·config·환경변수·DEV/PROD·KeepAlive·업데이트 피드·설치판은 변경하지 않았다. 실제 서버에 새 API/SQL을 배포하지 않았다.

이 단계에서 캐시의 파일/메타데이터 형식과 읽기 확인 계약을 확정 가능한 코드로 구체화했다. 실제 네이티브 이식, 서버의 제품용 확인 API, 편집 저장소·동기화 동작은 후속 구현 범위다. 앱의 고정 online/offline 유형과 A안 배치는 그대로 유지한다.

## 파일 식별과 원본 격리

| 항목 | 온라인 캐시 v1 |
|---|---|
| 파일 이름 | online-cache.sqlite |
| application_id | 1464487221 (registry의 1464487220과 구분) |
| user_version | 1 — 로컬 제품 DB19와 별도 버전 축 |
| family | wjb-online-cache |
| 식별 범위 | ownerId + workspaceId + deviceId + generation |
| 스냅샷 무결성 | snapshotHash(SHA-256), 고정 ASCII 정렬·정규 JSON |
| 원본 접근 | 명시적 보호 루트와 캐시 루트 양방향 겹침 금지 |
| 기존 파일 | 덮어쓰기/자동 변환/자동 migration 금지 |

캐시는 **이미 존재하는 온라인 공간의 이 기기 저장소**다. 새 오프라인 공간으로 등록하거나 이 파일 자체를 온라인 공간의 서버 생성으로 간주하지 않는다. 원본에서 시작할 경우 기존 이관 단계가 별도 온라인 workspaceId를 만들며 원본 이름/폴더/DB/이미지/백업을 유지한다. 다른 기기에서 받으면 같은 온라인 workspaceId와 해당 기기의 deviceId를 사용한다.

캐시 생성은 전용 가상 디렉터리 안의 독점 임시 파일에서 transaction/검사/fsync를 끝내고 hard link로 최종 이름에 **덮어쓰기 없이** 게시한다. 임시 링크 제거와 디렉터리 fsync까지 수행한다. 파일은 0600으로 생성한다. 기존 다른 DB·외부 파일·심볼릭 링크·하드 링크를 캐시로 재사용하지 않는다. 읽기는 readOnly SQLite transaction에서 헤더·스키마 서명·integrity·범위·내용 해시를 검사한다.

현재 구현은 기존 캐시를 교체/삭제하지 않는다. 프로세스 강제 종료 시 남을 수 있는 stage/다중 링크의 복구 정책은 native 단계에서 별도 구현해야 한다. OS의 파일 교체 경쟁을 완전히 방어하는 native 파일 핸들 API나 Windows/macOS 실기를 검증한 것으로 해석하지 않는다.

## DB 내용과 이미지 경계

| STRICT 테이블 | 저장 내용 | 저장하지 않는 것 |
|---|---|---|
| cache_info | 단일 manifest: family/version/cacheId/owner/workspace/device/generation/snapshotHash | 로그인 키·로컬 원본 경로·이미지 |
| records | entityType/entityId/revision/body JSON, 복합 PK | 이미지 binary/base64/data URL |
| assets | objectId/sha256/bytes | 본문/썸네일 bytes·임시 서명 URL |
| envelopes | outbox/inbox/conflict별 envelopeId/payload JSON | 원본 이미지·credential payload |

이미지 주소는 `{objectId, sha256, bytes}` 참조만 담는다. `storeId: supabase-private`, `objectKey: <workspaceId>/<objectId>`는 읽을 때 범위로부터 계산한다. Blob bytes를 DB로 복사하지 않는다. 같은 hash를 가진 서로 다른 logical objectId도 유지하므로 콘텐츠 dedup와 업무 객체의 식별을 혼동하지 않는다. Blob의 실제 생성/다운로드/리사이즈는 기존 Storage 계층과 이후 native asset cache의 책임이다.

모든 JSON 쓰기/재열기에서 중첩 depth/타입과 금지 필드를 검사한다. 지원 이미지의 알려진 base64/binary 표현, data URL, SVG 본문, data/thumb/base64/binary 등의 payload 필드를 거절한다. JSON 문자열로 이중 포장하거나 unicode escape로 감싼 문서도 풀어 검사한다. Blob catalog에 있는 hash와 일치하는 base64 bytes는 이미지 헤더가 알려지지 않았어도 거절한다. objectId 참조가 catalog의 hash/크기와 다르면 중단한다.

이 검사는 **참조만 쓰는 저장 경로를 강제하는 보조 경계**이며 임의 문자열에 숨긴 모든 인코딩/암호문을 판별하는 이미지 분석기는 아니다. 최종 제품에서는 도메인별 허용 필드 검증과 asset API가 이미지 바이트를 DB 저장 API에 전달하지 않는 경계를 함께 유지해야 한다. 현재 입력은 엄격한 DB18/19 이관 매핑을 거친 가상 metadata로 검사했다. 알 수 없는 표현을 조용히 지우거나 생략하지 않는다.

구조 검증 한도는 records/assets 각각 100,000개, JSON 16MiB/항목, depth64, 정수/세대 범위 검사다. Blob descriptor의 512MiB 한도는 과대 입력 방지용이며 무료 Storage의 업로드 허용량이나 권장 이미지 용량 정책이 아니다. 실제 업로드는 Storage 계층의 용량·최적화 정책을 별도로 따라야 한다.

## API와 적용 범위

| API | 동작 |
|---|---|
| createOnlineCache(root, options) | scope·스냅샷을 검사하고 새 별도 캐시 생성. 서버 생성/검증/활성화는 아님 |
| openOnlineCache(root, options) | 원본과 다른 형식/스키마/범위/스냅샷을 readOnly로 확인 |
| appendCacheEnvelope(root, options) | outbox/inbox/conflict용 metadata를 atomic insert. 실제 전송/수신/충돌 해결 엔진은 아님 |
| openVerifiedOnlineCache(options) | 로컬 검사 + trusted remote 확인 + 요청 guard + 유효 기간 후 snapshot-read 핸들 제공 |

캐시 생성 입력은 `{records:[{entityType,entityId,revision,body}], assets:[{objectId,sha256,bytes}]}`다. 캐시 revision은 서버 계약에서 정할 revision이며, DB19 본문의 기존 revision과 동일한 개념으로 자동 추정하지 않는다. 시험에서는 synthetic server revision을 사용하고 원본 body의 revision/삭제 잠금 등은 그대로 보존한다. 빈 공간도 지원한다.

캐시는 아직 JournalRepository/SqlDriver를 구현하지 않는다. 읽기 핸들은 `readRecords/readAssets/close`만 제공하고 raw SQL/쓰기 메서드는 내보내지 않는다. 읽기 transaction이 스냅샷을 고정하므로 쓰기 작업은 닫은 뒤 직렬화해야 한다. 조회 결과는 복제하여 UI나 호출자가 내부 스냅샷을 변경하지 못하게 한다.

outbox/inbox/conflict에 미처리 기록이 있으면 현재 읽기 활성화는 `CACHE_PENDING_REQUIRES_SYNC`로 거절한다. 로컬 편집을 무시하고 오래된 서버 스냅샷을 여는 경로를 만들지 않는다. 이후 동기화 단계에서 처리/복구 계약을 구현한다. 지금 자동으로 큐를 지우거나 서버판으로 교체하지 않는다.

## 원격 확인 계약과 제품 활성화 구분

원격 어댑터는 native/server가 소유한 callback이며 UI가 전달한 boolean/receipt를 받는 API가 아니다. 계정·권한·기기·세대·완료된 Blob 검증을 실제 backend가 확인해야 한다. **현재 DEV의 이관 PoC API에는 이 제품 계약이 없다.** 기존 응답의 이름만 바꿔 호환된 것처럼 다루지 않는다.

미래 `wjb-online-activation-v1` 응답에서 검사할 항목:

- status verified, capability snapshot-read, family/version 일치
- ownerId/workspaceId/deviceId/generation/snapshotHash 일치
- assetCatalogHash 일치와 assetsState verified
- issuedAt/expiresAt 정수: 발급 1분 이내, 최대 수명 5분, 미래 발급·만료·잘못된 시계 거절
- 서버 응답을 기다린 후와 각 조회에서 요청/계정 guard 확인, 시계 역행·만료 차단·핸들 닫기. 폐기된 핸들은 계정이 돌아와도 재활성화하지 않음

수명 값은 이번 reference의 보수적 기본 계약이다. native에서는 신뢰 가능한 시간·세션 취소 이벤트·재확인 수명을 함께 구현해야 한다. 현재 callback 시험은 가상 응답이며 실제 서버 인증/취소 SLA를 검증한 결과가 아니다.

확인 핸들이 반환하는 것은 **cache-verified / snapshot-read / productActivationAllowed:false**다. 이 증거를 69/70문서의 `connected-product-v1 / workspace-runtime` 증표로 승격하지 않는다. `openRegisteredWorkspace`가 이 증거로 앱 편집 런타임을 열지 않는 것도 검사했다. 실제 제품 활성화에는 native repository/이미지 접근·저장/큐·인증 수명·서버 제품 capability 검증이 더 필요하다.

검증 실패·계정 변경·늦은 응답 시 SQLite 핸들을 닫고 오프라인 원본으로 fallback하지 않는다. raw backend 오류는 이 내부 모듈에서 UI에 직접 표시하지 않으며 native command boundary의 고정 오류 매핑을 통해 전달해야 한다.

## 검증

신규 **73개** + 기존 V2 회귀 **235개**, 총 **308개 통과 / 실패 0**.

실제 임시 SQLite에서 DB18/19 원본 hash/파일 목록 불변, 전체 매핑된 레코드·DB19 삭제 잠금 보존, header/schema/내용 변조·wrong owner/workspace/device/generation 거절, 독점 생성, alias/보호 루트, 본문/썸네일/중첩 JSON·알려진 Blob bytes 재삽입 거절, 세 가지 envelope 경계, 계정 guard·수명·server/Blob 확인 오류와 늦은 응답 정리, 제품 런타임 승격 금지를 검사했다.

```sh
node --test poc/v2-runtime/online-cache.test.mjs
node --test poc/v2-runtime/*.test.mjs poc/v2-assets/connected-copy.test.mjs poc/v2-migration/*.test.mjs poc/v2-sync/db18.test.mjs
npm run lint
npm run format:check
```

[전체 회귀 로그](evidence/online-cache-regression.txt) · [집계/소스 hash](evidence/online-cache-pass.json)

앱/UI/실제 Cloud를 변경하지 않았으므로 과거 앱532·Chromium26·A안9배치·DEV/PG 시험을 이번 실행으로 합산하지 않는다. Windows/macOS의 native 설치·Keychain/junction/파일 잠금·전원 중단 복구는 후속 검증이다.

## 다음 단계

다음은 **native 실행 프로필·설정 경로·OS 자격증명 저장소 격리**다. 별도 앱/설치 식별 정책은 여전히 미확정이므로 실제 설치 설정 적용 전에 확정한다. 후보 프로필 설계와 실제 Classic의 고정 config/update/cache 경로가 충돌하지 않는지 구체화한다.

이후 native cache/repository 포트와 실제 서버 활성화 API → 기존 appController 단일 전환 경계 재사용 → A안 제품 UI 연결로 진행한다. 편집·다중 기기 변경 전송/충돌/큐 처리는 7번 동기화 단계에서 계속 검증하고, 8번 전면 다국어도 별도 후속 범위로 유지한다. 로컬 전용 모델과 기존 원본은 영구 유지한다.
