# 19. Supabase 운영/개발 통합과 무료 프로젝트 여유 검토

2026-11-08 (KST) · woori-bldg 읽기 전용 분석 기반. 실제 DB 전환/삭제·환경변수 수정 없음.

## 19.1 먼저 구분할 개념

| 개념 | 의미 |
|---|---|
| Git/Vercel 브랜치 | 코드/앱 배포 구분. DB URL이 같으면 같은 DB에 접근 |
| Supabase 프로젝트 | DB·Auth·Storage·Functions 등 환경의 단위 |
| Supabase 관리형 branch | 별도 서비스 환경·접근 정보. 사용량/과금과 제공 조건을 확인해야 함 |
| 한 DB 내 다른 schema | SQL 이름 공간. Auth·함수·시크릿·cron까지 환경 분리되는 것은 아님 |
| 로컬 Supabase 개발 스택 | 로컬 DB/Auth/Storage/Functions 환경. 원격 개발 프로젝트를 대체할 수 있는지 검증 필요 |

**Neon의 브랜치 경험을 Supabase 무료 브랜치라고 그대로 해석하지 않는다.** 프로젝트 수가 줄어도 전체 비용이 줄어드는지는 다른 문제다.

## 19.2 공식 문서에서 확인한 조건

공식 `supabase/supabase` 저장소의 문서 원문을2026-11-08에 읽었다. 서비스 콘솔의 사용자 플랜/실제 과금은 읽지 않았다.

- [Branching](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/deployment/branching.mdx): 각 branch는 별도 Supabase 환경/자격증명을 사용한다. 기본은 데이터/Storage 객체가 없는 환경이며 schema는 migration 이력으로 구성한다. OAuth/SMTP 시크릿 등은 별도 설정 확인이 필요하다.
- [Manage Branching usage](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/platform/manage-your-usage/branching.mdx): preview branch 환경의 compute/disk/egress/storage 사용량이 청구 대상이고, **branch 사용량은 Spend Cap으로 보호되지 않는다고 명시**한다.
- [Billing](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/platform/billing-on-supabase.mdx): 무료 프로젝트2개는 owner/admin에 걸쳐 적용되는 한도이며, 조직 단위 구독·프로젝트별 연산 비용을 설명한다.

따라서 ‘운영·개발을 한 프로젝트의 브랜치로 바꾸면 **무료로** 하나가 빈다’고 지금 확정할 수 없다. 기능의 현재 플랜 제공 조건·persistent/preview 실제 과금·프로젝트 계산 방식과 계정 구독을 함께 확인해야 한다. 가격 partial/최신 청구서까지 검증한 정액 견적은 아니다.

## 19.3 전환 대안

| 안 | 원격 개발 프로젝트 대체 | 비용/격리 판단 | 추천 |
|---|---|---|---|
| **A. 운영 원격 유지 + 로컬 Supabase 개발** | 로컬 DB/Auth/Functions+가상 seed로 검증 후 가능 | 추가 원격 branch 과금 없이 여유 확보를 검토할 수 있음. 로컬 Docker/리소스·클라우드 고유 기능 차이 존재 | **무료 우선 비교안** |
| B. 운영+관리형 개발 branch | 기능/요금 확인 후 가능 | 서비스 격리 장점. branch 사용량·플랜 비용이 생기면 슬롯 확보보다 비용 증가 가능 | 편의/예산을 수용할 때 비교 |
| C. 같은 프로젝트의 prod/dev schema | 테이블은 나눌 수 있음 | OAuth/권한/전역 함수/cron/스토리지 혼입 위험, 단순 분리로 간주 못함 | 비추천 |
| D. 개발 DB만 Neon으로 이전 | PostgreSQL 자체는 후보 | Supabase Auth/RLS/Functions의 환경을 재현하려면 별도 설계 필요 | woori의 단순 대체안으로 비추천 |

A에서 cloud-only 기능 확인이 필요하면, 기존 개발 프로젝트를 유지한 채 검증하고 이후 회수 여부를 판단한다. 원격 개발 DB를 먼저 없앤 뒤 로컬 환경을 만드는 순서는 피한다.

## 19.4 woori 전환 전 확인표

1. 운영/개발 각각의 migration 이력·schema·RLS/RPC·데이터 차이를 비교한다. 개발 고유 작업/테스트 자료를 분류·보존한다.
2. Auth provider·사용자/관리자·callback/redirect·메일 설정을 목록화한다. 실제 사용자 credential을 로컬 fixture로 무조건 복제하지 않는다.
3. Functions 배포본·프로젝트 secrets/Vault·cron·webhook·SMS/메일 공급자·날씨 갱신을 조사한다. 테스트 경로의 실제 발송/운영 호출은 차단한다.
4. Storage bucket·원본 객체·접근 정책·URL, cron job, 관리 계정/요금·리전 정보를 기록한다. 저장소에 없다는 이유로 실제 콘솔에도 없다고 판단하지 않는다.
5. 로컬 스택의 지원 기능을 확인하고 version을 고정한다. 현재 repo에 완전한 로컬 설정/seed가 있다는 가정 없이 구성 차이를 문서화한다.
6. 앱 dev/preview의 DB URL·키·OAuth callback을 로컬/선택 branch에 정확히 연결한다. 배너 외에 빌드/런타임 대상 검증을 두어 prod 오연결을 막는다.
7. 핵심 화면·Google 로그인/관리자·RPC/RLS·모의 알림·마이그레이션·되돌리기를 검증한다. cloud와 local 간 차이는 미지원/별도 시험으로 명시한다.
8. 개발 대체가 검증되면 기존 dev의 DB/필요 자산·설정/이력을 안전하게 보존하고, 전환 영향과 복구 계획을 검토한다.
9. **사용자가 삭제/구독 변경 범위에 별도 승인한 뒤에만** 기존 dev 프로젝트 회수/정리 작업을 진행한다. 정책·청구서·실제 슬롯 변화를 확인한다.
10. 빈 슬롯이 실제 확인된 후 V2 프로젝트 생성 여부를 결정한다. woori 운영과 V2를 같은 프로젝트에 합치지 않는다.

현재는1~10의 실행 계획을 정리한 상태이며 어떤 단계도 실제 DB/대시보드에 적용하지 않았다.

## 19.5 V2에 대한 결론

- **우선 검토 유지:** Neon 신규 V2 구성은 기존 woori 변경과 독립적으로 평가한다. 실제 작은 운영 사례의 연결/이미지/사용량 관리 교훈을 반영한다.
- **조건부로 다시 열린 후보:** woori 개발 환경을 검증된 로컬 스택으로 대체하거나 branch 비용이 예산 내이면 Supabase 슬롯 회수 가능성을 검토할 수 있다. 현재 한도가 소진된 사실을 ‘곧 여유 있음’으로 바꾸지 않는다.
- **선택 기준:** 슬롯 회수의 실제 가능성 + 기존 서비스 전환/운영 시간 + 새 서비스의 Auth/private blob/API·메일 합산 비용 + 아시아/복원 조건. DB 가격만 비교하지 않는다.
- 무료 목표에 맞는 구성이라도 V2의 원본·권한·충돌·복구 기준은 유지한다. 요금 조건을 맞추려고 기존 서비스 DB를 파괴하거나 여러 제품을 같은 auth/권한 공간에 임의 합치지 않는다.
