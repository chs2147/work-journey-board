# 52. 개발 서버 키·실제 Auth·공간 격리 검증

2026-11-10 06:20 KST · v2-design · 앱1.23.3/로컬 DB18 유지

## 완료한 범위

환경 revision2/current, running, network enforced와 개발 서버 Secret ready 확인 후 **개발 프로젝트 vsphftnmfzfoufasjttd만** 시험했다. 서버 키 없는 세션 RPC는401, 서버 키로 조회한 미등록 세션은200/false였다([증거](evidence/development-server-rpc-check.json)).

메일 발송 없는 Admin 사용자 생성(email_confirm=true)으로 임시 계정2개를 만들었다. 무작위 암호·access/refresh token·서버 키는 메모리에만 두고 로그/파일/Git에 남기지 않았다. 실제 업무 자료는 사용하지 않았다.

| 실제 개발 서버 시험 | 결과 |
|---|---|
| 계정2개 password 로그인·공개 JWKS 기반 기존 ES256 verifier 검증 | 통과 |
| 본인 세션 활성·다른 사용자/세션 조합 거절 | 통과 |
| 일반 사용자 JWT로 서버 전용 RPC 직접 실행 | 거절 |
| 계정A의 workspace/기기를 임시 생성하고 본인 자산8bytes 예약 | reserved/created=true |
| 계정B의 정상 기기·세션으로 A의 workspace 접근 | ACCESS_DENIED |
| 서버 세션 회수 RPC 이후 A의 세션 활성/metadata 요청 | false / ACCESS_REVOKED |
| A 회수 후 B 세션 | 활성 유지 |
| 시험 종료 정리 | Auth 사용자2개 조회404, 시험 metadata/blocked_session 잔여0 |

총20개 실제 검증과 정리 확인2개가 통과했다([실행 결과](evidence/development-auth-live-check.json)). 세션 회수는 설치된 **wjb_v2_revoke_session의 차단 목록 방식**이며 Supabase Auth 로그아웃·refresh token 폐기 전체를 시험한 것은 아니다. JWT 서명 검증과 실제 서버 세션 검사는 각각 수행했으며, 공개 배포 gateway를 통한 종단간 시험은 아직 아니다.

## 재현과 경계

[auth-live-check.py](../../poc/v2-cloud/development/auth-live-check.py)는 명시적 플래그와 DEV 환경/ref를 요구하며 고정 DEV origin만 사용한다. HTTP redirect를 따르지 않는다. 생성한 UUID에 한정해 finally에서 metadata·차단 행·Auth 계정을 정리하고 부재를 확인한다. 실패 시 비밀을 출력하지 않고 미정리 식별자를 증거에 남긴다. 자동 스케줄/제품 시작 경로에는 연결하지 않았다.

```sh
python3 poc/v2-cloud/development/auth-live-check.py --run-development-fixtures
```

이 명령은 읽기 전용이 아니다. 개발 Auth/임시 metadata를 만들고 제거하므로 readiness와 대상 확인 후 필요한 경우에만 수동 실행한다. 서버 키는 HTTP 시크릿 WJB_SUPABASE_DEV_SERVICE_ROLE_KEY(개발 호스트), 관리 키는 WJB_SUPABASE_DEV_MANAGEMENT_TOKEN(api.supabase.com)으로 분리한다. 키를 명령행 인자에 넣지 않는다.

기존 Auth28+세션 adapter11+개발 gateway10 회귀 검사도 다시 통과했다. 설치 SQL 재실행·schema 변경·버킷/Blob 생성·메일 전송·호스팅/과금 활성화·main/제품 코드 수정은 하지 않았다. Free/Usage의 개발 대시보드 확인(U07)은 여전히 남아 있다.

## 다음 단계

1. 48문서의 private Blob 후보를 현재 무료 한도·과금 방지·아시아 정책과 함께 비교해 공급자 선택안을 확정한다. 아직 Supabase Storage를 최종 선택하지 않았다.
2. 선택한 공급자의 테스트 자산 범위/무료 잔여량을 확인한 뒤 gateway 실제 전송·조회·삭제·장애 복구를 검증한다. 현재 예약 metadata 성공은 실제 파일 전송 성공이 아니다.
3. 별도로 V1/V2 앱 ID·설정·업데이트 채널·원본 복사 경계를 구현하고, 이미지 최적화/dedup PoC와 실제 기기 동기화로 확장한다. 기존 V1 로컬 모델은 유지한다.
