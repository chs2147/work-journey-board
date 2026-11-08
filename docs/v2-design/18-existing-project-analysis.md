# 18. 실제 운영 사례 분석 — my-money-note / woori-bldg

2026-11-08 (KST) · 읽기 전용 코드/문서 분석. 두 서비스·DB·인증·요금 설정은 변경하지 않았다. 실제 콘솔 사용량/청구서/현재 배포 상태는 조회하지 않았다.

## 18.1 기준과 근거

| 저장소 | 분석 snapshot | 주요 근거 |
|---|---|---|
| my-money-note | `2dc7c448ad3f5490ae1f9f1663e8d2f18dc22d9b` | lib/db/client.ts, lib/neon-usage.ts, lib/blob-usage.ts, lib/hobby/image-resize.ts, app/api/hobby/photos/route.ts, docs/db-migration.md, docs/roadmap.md, docs/backup-policy.md |
| woori-bldg | `a8fdf4733987e77ddce359b4caf4d4642d8ebae5` | docs/changelog.md(2026-06-30), docs/architecture.md, app/src/lib/supabase.ts, app/vite.config.ts, app/src/components/DevBanner.tsx, supabase/migrations, supabase/functions |

원문: [Neon 연결 코드](https://github.com/chs2147/my-money-note/blob/2dc7c448ad3f5490ae1f9f1663e8d2f18dc22d9b/lib/db/client.ts) · [Neon 운영 기록](https://github.com/chs2147/my-money-note/blob/2dc7c448ad3f5490ae1f9f1663e8d2f18dc22d9b/docs/db-migration.md) · [Supabase 환경 분리 기록](https://github.com/chs2147/woori-bldg/blob/a8fdf4733987e77ddce359b4caf4d4642d8ebae5/docs/changelog.md).

## 18.2 my-money-note에서 확인한 적용 사항

| 확인한 구현/기록 | V2에 적용할 판단 |
|---|---|
| Vercel Next.js 서버 + 표준 PostgreSQL `postgres` 연결 | Neon 사용이 추상 후보가 아니라 실제 사용 경험이 있음. 서버 경계와 SQL 계약을 재사용할 가치가 큼 |
| pooled URL, max5, idle20초, 연결 지연 생성, prepare:false | 서버리스 연결 폭증·빌드 시 불필요 연결·마이그레이션 후 prepared 결과형 문제의 실제 교훈. 숫자/옵션은 선택할 V2 드라이버로 재검증 |
| `production`/`dev-db` Neon 브랜치 분리 기록 | 개발/운영을 한 Neon 프로젝트의 브랜치로 격리한 사례가 이미 있음. 브랜치가 무료 연산/스토리지 예산을 공유할 수 있어 사용량 합산 필요 |
| Neon 사용량12시간 캐시·수동 갱신 | 작은 서비스의 관측 UI로 유용. V2 캐시는 project/branch/store identity를 포함하고 관리 지표를 일반 사용자에게 노출하지 않음 |
| 상세1200px·목록400px JPEG 저장, 인식용 원본은 별도 | 이미지 크기를 줄이면 파일 용량 중심으로 무료 범위가 넓어질 수 있다는 사용자 경험을 뒷받침 |
| DB 밖 Vercel Blob에 이미지·섬네일 저장 | DB 용량과 파일 용량을 분리해 평가할 수 있음. URL/manifest·자산 GC의 정합성은 별도 필요 |
| Blob70% 경고·스토어 ID별 캐시·사용량 UI | 한도 전에 사용자에게 알리고, 환경을 바꿔도 다른 스토어 사용량을 표시하지 않는 패턴 재사용 |
| 로컬 전체 백업과 하루1회 이메일 재정 백업 | 작은 규모에서 복잡한 백업 서비스를 줄일 수 있는 사례. 백업 범위/인증정보·자산 포함 여부를 정확히 구분해야 함 |

문서의 월100 CU-hours/DB0.5GB/전송5GB, Blob1GB·약293KB/건·약3,600건 등의 수치는 **해당 snapshot의 상수·운영 기록**이다. 현재 플랜의 보장값이나 V2 견적값으로 승격하지 않는다. 기록상 용량과 개수는 단위/샘플·삭제/보존량에 따라 달라 실제 bytes로 다시 계산한다.

## 18.3 그대로 가져오면 안 되는 부분

- **사진은 공개 Blob URL**이다. 업로드 API가 로그인 검사를 하더라도 저장된 사진 URL의 다운로드 자체가 workspace 권한으로 보호되는 구조는 아니다. V2 비공개 업무 자료는 private 저장+인증된 다운로드/제한된 URL을 검증한다. 이 변경의 무료/개인 플랜 조건도 비용에 넣는다.
- 사진 앱의 JPEG 축소를 메모 이미지/스크린샷 전체에 강제하면 작은 글자·투명도·원본 품질을 잃을 수 있다. V2는 원본을 조용히 대체하지 않고 로컬 원본 보존·최적화 선택·실제 읽기 품질과 hash/복원 정책을 정한다.
- 현재 세션은 고정 slot1~3·HMAC 기반 개인 앱 모델이다. 불특정 사용자의 가입/계정별 공간·기기 회수·이메일 OTP 서비스를 그대로 충족하지 않는다.
- Resend sandbox 발신·단일 지정 수신자 방식은 본인 메일 수신 사례다. 외부 사용자 인증 메일은 도메인·발신 인증·수신자/요금·전달률을 별도로 확인한다.
- 데이터 이메일 백업이 이미지 원본·전체 계정 복원까지 포함한다고 보지 않는다. V2는 비공개 문서/자산을 일관되게 복원해야 하며 업무 내용을 이메일에 무조건 첨부하지 않는다.
- 과거 경험의 ‘주기적 쓰기로 pause 방지’는 Neon에 적용하지 않는다. 이 저장소는 오히려 keep-alive가 무료 연산을 소모한다는 이유로 배제한 기록이 있다.
- 동일한 Vercel/Blob 무료 조건을 재사용할 수 있는지는 계정 합산·공개 서비스 이용약관·private 저장 기능·현재 한도를 확인해야 한다.

## 18.4 무료 가능성에 대한 수정 결론

**작은 데이터와 제한된 사용자라면 무료 범위에서 가능할 수 있다는 판단은 실제 사례로 근거가 강화됐다.** 다만 파일 크기 하나로 결정되는 것은 아니다. DB/branch 차이 저장, compute 활성 시간, 다운로드·등록/삭제 요청, Auth/메일·서버 함수·비공개 저장의 합산을 본다.

V2 원본 bytes + 썸네일 + 복원본이 계속 참조하는 과거 원본 + 미완료 staging + 개발 환경 사본을 합친다. 연산은 사용자·기기별 조회/수정과 사용량 화면 자체의 DB 접근도 포함한다. 복구본은 검증된 manifest로 자산을 재사용하되 참조 중인 원본을 삭제하지 않는다.

첫 실측은 가상 사용자5명·기기2대·사진/스크린샷/텍스트 메모 혼합 샘플로 한다. 파일 최적화 전후 품질·용량, 활성/휴면 시간, 최초 다운로드·동기화 전송량을 기록한다. 단일 사용자 가계부의 성공을 다기기 동기화 성공으로 간주하지 않는다.

## 18.5 woori-bldg에서 확인한 것

- 변경 이력은 운영 프로젝트와 별도 개발 프로젝트를 만들고 개발용 URL/키를 연결했다고 기록한다. `supabase.ts`는 환경변수의 URL/키로 대상 프로젝트를 고른다.
- Git 브랜치/Preview는 앱 배포 상태이며 DB 분기를 자동 생성하는 설정이라는 증거는 없다. 실제 연결 DB ref를 표시하는 배너는 오인 방지에 유용하지만 격리/접근 차단 장치는 아니다.
- Supabase Auth·Google OAuth·RLS·RPC·Edge Functions·Vault/cron·SMS·날씨 갱신 의존성이 존재한다. 단순 PostgreSQL 데이터만 옮기는 작업이 아니다.
- 과거 dev/prod에 SMS 관련 함수/시크릿/cron 적용 기록이 있고, keepalive migration도 있다. 신규 테스트 환경에서 실제 메시지/메일·운영 webhook/cron이 실행되지 않게 해야 한다.
- 이 분석은 저장소 기록 기준이다. 현재 개발 DB에 고유한 미병합 schema/data가 있는지, 현재 함수/인증/cron/Storage 상태는 콘솔/실제 비교가 필요하다.

## 18.6 다음 비교 기준

Neon 중심 신규 V2는 기존 운영 환경을 건드리지 않고 검토할 수 있다. Supabase는 개발 환경을 로컬로 옮기거나 공식 브랜치 요금을 수용할 경우 여유 확보 가능성을 재검토한다. **한도 확보를 전제로 기존 개발 프로젝트를 지금 삭제하지 않는다.** 구체 비교/확인 절차는 [19문서](19-supabase-env-consolidation.md)를 따른다.
