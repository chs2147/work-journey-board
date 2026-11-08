# 33. 로컬 PostgreSQL 최소 서버 시험 결과

2026-11-08 · `v2-design` · 제품1.23.0 / DB18 유지

**후속:** 기기 회수/자산 확장과 인증 라이브러리 검증은 [34문서](34-auth-private-assets-results.md)에 기록했다. 아래39개는 최초 최소 SQL 단계의 결과다.

## 구현과 결과

사용자의 ‘커밋/푸시하고 다음 단계’ 요청으로 기존 `ec114ca`의 원격 반영을 확인한 뒤, [32문서](32-cloud-readonly-results.md)의 다음 최소 적용 묶음 중 **로컬 스키마·명령/권한 시험**을 구현했다. 실제 Supabase에는 쓰거나 설정을 변경하지 않았다.

[poc/v2-postgres](../../poc/v2-postgres/README.md)에 로컬 bootstrap·실험용 SQL·Python 실행 도구를 추가했다. 실제 PostgreSQL17.11에서 **39개 시험이 모두 통과**했다. 정리 전 첫 실행과 실행 도구 정리 후 최종 실행 모두39개 성공이다. 최종 증거는 [JSON](evidence/local-postgres-pass.json)이며 코드3개의 SHA256·이미지 digest·DB 버전·세부 시험명을 포함한다. 최종 원시 로그는 `/tmp/wjb-v2-postgres-final.log`, 원본 결과는 `/tmp/wjb-v2-postgres-tc22gzeo/results.json`이다.

| 검증 묶음 | 실제 확인 |
|---|---|
| 계정/공간 격리 | 소유 공간만 조회, 타 계정 레코드/변경 로그 안 보임, 다른 공간 쓰기 거절 |
| 기기/세션 | 다른 기기·잘못된/누락 세션·누락 사용자 거절, 회수 후 읽기/캐시 명령 재시도 거절 |
| 직접 접근 | 클라이언트 직접 INSERT/UPDATE/DELETE 거절, 내부 장부/기기 테이블 읽기 거절, anon 함수 호출 거절 |
| 입력/버전 | 잘못된 generation·stale revision·잘못된 신규 base·null·음수·UTF-8 크기 초과 거절 |
| 멱등 | 동일 요청 같은 결과, 동일 키의 본문/대상/base 변경 거절, 후속 수정 후 과거 ack 유지 |
| 원자성 | 장부 INSERT 직전 주입 실패 시 레코드·로그·cursor·장부 전부 rollback, caller rollback 후 정상 재시도 |
| 경쟁 | 두 연결의 동일 op 한 번 반영, 같은 base의 수정 한쪽만 성공 |
| 커밋 순서 | 먼저 잠근 트랜잭션의 미커밋 데이터 비노출·뒤 연결의 잠금 대기 확인 후 연속 cursor 순서대로 반영 |
| 최소 권한 구조 |5테이블 RLS 활성화, definer 함수2개가 non-superuser/non-bypassrls 소유 |

## 구현 경계

테이블은 workspace·device_session·text_record·applied_operation·change_log다. 최초 owner만 지원하고 최소 텍스트 생성/수정 명령만 있다. 기기 행 공유 잠금과 공간 행 갱신 잠금을 커밋까지 유지해 회수/공간 커서와 경합을 제어한다. 승인된 명령의 레코드·revision·로그·cursor·멱등 결과는 한 트랜잭션에 속한다.

client는 SELECT/RPC 일부만 허용하고 테이블 직접 쓰기를 금지한다. SECURITY DEFINER는 고정 search_path와 명시적 권한 검사를 사용한다. 테이블 소유자는 RLS를 우회할 수 있으므로 non-superuser라는 이유만으로 안전하다고 판단하지 않는다. client RLS와 함수 내부 검사를 각각 시험했다. bigint 결과는 JavaScript 정밀도 손실을 피하도록 십진 문자열로 반환한다.

## 환경·한계

Docker는 로컬 소켓을 명시해 원격 context를 사용하지 않는다. 컨테이너는 외부 네트워크/공개 포트/TCP 수신 없이 데이터 tmpfs·메모리512MiB·CPU1로 실행했고 각 실행의 finally에서 제거했다. 실제 SQL 시험에는 Docker 외의 새 패키지를 설치하지 않았고 앱 의존성/lockfile을 변경하지 않았다.

**Auth는 시험 stub이다.** 가상 claims를 지정한 로컬 역할 연결이므로 JWT 서명·만료·issuer/audience·실제 Supabase session 회수·PKCE·HTTP 요청 인증을 검증한 것은 아니다. 해당 claims를 믿을 수 있게 만드는 gateway와 공개 RPC 허용 목록은 후속이다. 실험 SQL의 역할/스키마 준비와 migration 소유자도 cloud 적용 전 별도 검토가 필요하다.

실제 Auth/Storage 권한·전체 업무/부모자식·문서 링크·삭제/복원/로그 정리·자산 전송·Windows/macOS 제품 통합은 범위 밖이다. 기존214개 SQLite 시험의 구현을 PostgreSQL로 전부 옮긴 것도 아니다. 앱/기존 migration/릴리스/전체 P01~P22 상태는 유지한다. 클라우드 잔여량도 새로 측정하지 않았다.

## 다음 순서

1. 실제 Supabase JWT/세션 검증과 로컬 stub의 차이를 반영한 API·기기 등록/회수 계약, private 자산 최소 정책/업로드 확정 시험을 준비한다.
2. Auth callback·무료 SMTP 조건과 Usage 잔여량을 확인한다. 로컬 인증 메일 시험과 외부 사용자 발송 준비를 분리한다.
3. 클라우드용 적용 SQL·역할·bucket·정책·가상 표본 범위·복구 절차를 검토 가능하게 제시한 뒤 소형 클라우드 시험으로 이어간다. 현재 로컬 SQL을 그대로 운영 프로젝트에 실행하지 않는다.
