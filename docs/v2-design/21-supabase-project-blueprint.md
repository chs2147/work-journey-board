# 21. V2 Supabase 프로젝트 구성안

2026-11-08 (KST) · 설계용. 실제 계정/콘솔/DB에는 접속하지 않았다.

## 21.1 이번 진행 기준

사용자가 신규 Supabase 계정 및 Keep Alive 기본 요구를 제시한 뒤 다음 단계 진행을 요청했다. **Supabase 통합 구성을 1차 상세 설계의 작업 기준**으로 삼는다. 이는 실제 플랜/리전 검증·프로젝트 생성·구현 착수·서비스 출시의 승인이 아니다. Neon은 현재 비용/조건을 충족하지 못할 때 비교할 대안으로 유지한다.

기존 woori-bldg·my-money-note의 운영/개발 프로젝트는 재사용하거나 변경하지 않는다. V2는 별도 서비스·별도 권한/자산 경계를 갖는다. AWS 직접 운영 제외 원칙은 유지하며 Supabase 내부 클라우드까지 금지한다는 뜻으로 확대하지 않는다.

## 21.2 최소 구성 추천

| 구역 | 추천 구성 | 확정 전 확인 |
|---|---|---|
| 운영 | 아시아 primary region의 Supabase 프로젝트1개 | 새 계정의 실제 무료 여유·허용 리전·quota·일시중지/복구 |
| 개발 | 로컬 Supabase + 가상 seed 우선 | Docker/CLI 버전·Auth/Functions/cron 차이, 실제 사용 가능한 개발 환경 |
| 인증 | Supabase Auth + 제품 계정/기기 매핑 | OTP·native callback/refresh·회수·계정 복구·외부 SMTP |
| 업무 저장 | PostgreSQL의 명령/RLS·원자적 함수 | sync 계약·키 범위·역할/실행 권한 |
| 이미지/복구본 | private Storage | private 정책·서명 URL·용량/egress·복원 참조 |
| API | 검증된 서버 실행 경계 + DB 원자적 명령 | Edge Functions의 실제 플랜·시간/메모리·라이브러리·전송 제한 |
| 상태/알림 | 주기/수동부터, 실시간은 선택 검증 | 무료 메시지/동시 연결·idle 비용/요청량 |
| Keep Alive |20문서의 하루1회·고정1행·상태 기록 | 실제 휴면 판정 효과·중복 job/로그·실패/재개 |

운영/시험 자료는 권한과 endpoint를 분리한다. 로컬에서 재현되지 않는 클라우드 시험을 운영 자료에 직접 적용하지 않으며, 필요한 별도 시험 환경과 비용은 실행 계획에서 정한다. 유료 관리형 개발 branch를 기본 구성에 포함하지 않는다.

## 21.3 공식 자료 확인 결과와 비용 관문

다음은2026-11-08 공식 `supabase/supabase` 문서 소스를 읽은 결과다. 사용자 계정의 실제 설정·한도나 모든 가격표를 확인한 것은 아니다.

| 항목 | 확인 상태/의미 |
|---|---|
| 기본 SMTP | 공식 문서상 프로젝트 팀에 속한 사전 승인 주소로 제한, 비운영/시험 목적·전달 SLA 없음 |
| 외부 사용자 OTP | 사용자에게 메일을 보내려면 custom SMTP 구성 필요. 무료 발송량·발신 도메인·도메인 비용·rate limit 별도 확인 |
| 리전 | 프로젝트는 primary region1개. 일반 지역 선택은 그 범위의 사용 가능한 실제 리전에 배정되므로 특정 국가 보장이 아님 |
| DB/Storage/egress·함수·실시간 실제 quota | 현재 계정/플랜 대시보드 확인 전. 후속23문서에 공식 공개 기준을 추가했으며 계정 실측/무과금 보장과 구분 |
| Keep Alive | 기존 woori 코드 참고. 플랫폼 휴면 방지 효과는 미검증이며 복구/로컬 보존 필요 |
| 브랜치 과금 |19문서에서 별도 사용량 청구·Spend Cap 제외 확인. 기본 개발은 로컬 추천 |

근거: [SMTP](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/auth-smtp.mdx), [Auth limits](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/rate-limits.mdx), [Regions](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/platform/regions.mdx).

후속 [23문서](23-supabase-free-tier-readiness.md)에서 동적 컴포넌트가 참조하는 공식 설정 소스까지 확인해 리전 목록·공개 이메일/저장 한도를 보완했다. 실제 계정 선택 가능 상태는 별도다. 외부 메일 수신자를 조직 관리자/개발자로 초대해 시험용 제한을 피하는 방식은 제품의 가입 흐름으로 쓰지 않는다.

## 21.4 인증과 개발/운영 경계

- ko/en OTP 템플릿·인증 시도 제한·허용 callback을 환경별로 고정한다. Vercel/Git branch 이름만으로 DB가 격리된다고 판단하지 않는다.
- desktop은 공개 클라이언트 방식과 보안 저장소, 웹을 출시하면 cookie/CSRF/여러 탭을 추가 검증한다. 클라이언트에 service-role·DB 연결 문자열을 넣지 않는다.
- refresh/logout 기능과 서버의 기기 회수 효력을 구분한다. 토큰이 아직 유효해도 회수된 기기 요청은 제품 API에서 거절할 수 있어야 한다.
- 로컬 환경은 가상 계정/메일 수신함·외부 발송 차단을 우선한다. SMS·기존 프로젝트 webhook·실제 사용자 주소를 seed로 복제하지 않는다.

## 21.5 구현 전에 채울 설정 명세

실제 값을 이 문서에 수집하지 않는다. 다음 항목의 존재/역할·저장 위치만 계획한다: 운영/로컬 endpoint, public client key, 서버 전용 권한, JWT issuer/audience·세션 검증, allowed callbacks, SMTP와 발신 도메인, private bucket 식별자, 업로드 제한, cron job 이름/시각, 로그/보존/비용 상한.

비밀값은 배포 환경의 secret 저장소로 관리하고 백업·원격 동기화·Git 문서에 넣지 않는다. 테스트/운영의 대상 이름·버전·실제 endpoint를 관리자 화면에서 확인할 수 있게 하되 그 표시 자체를 보안 경계로 사용하지 않는다.

## 21.6 다음 관문

암호화는 TLS+서버 저장 암호화, 첫 플랫폼은 Windows·macOS로 사용자 확정됐다.22문서의 DB/권한/명령 계약과24문서의 로컬 fixture 기반 PoC 구현 범위를 검토하고, 클라우드 시험 전에 실제 플랜/메일/리전·예산/계정 복구를 정한다. 본 문서 작성으로 실제 자원 생성이나 Keep Alive 등록을 실행하지 않는다.
