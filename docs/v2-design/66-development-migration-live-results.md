# 66. DEV 전체 이관 실제 설치·Auth/Storage 통합 결과

2026-11-10 UTC · v2-design · 제품1.24.1/DB19 유지

## 완료 범위

Storage 연결 작업을3215cdb로 커밋·푸시한 뒤 진행 목록5번의 DEV 통합을 실행했다. 대상은 **vsphftnmfzfoufasjttd / 서울 ap-northeast-2**다. 운영 예정 프로젝트에는 접속하지 않았다. 기존 C1/C2 및 KeepAlive install.sql을 재실행하지 않고 새001/004만 적용했다. 실행 역할은 postgres/NOSUPERUSER/BYPASSRLS/read_write다. SQL bytes는 검토 manifest와369개 로컬 검증의 hash를 대조했다.

이관 테이블5개 모두 RLS true, binary column0, client RPC 실행 및 service_role 직접 테이블/ private helper 실행은 차단됐다. 기존 C1/C2 함수6개의 pg_get_functiondef hash와 cron 정의가 설치/시험 전후 동일하다. 새 이관 모듈은 DEV에 유지하며 fixture 데이터만 제거했다. 설치 파일은 다시 실행하지 않는다.

[설치 전 읽기 점검](evidence/migration-dev-readiness.json) · [적용한 SQL hash·쓰기 역할·ACL](evidence/migration-dev-install.json) · [시험 후 점검](evidence/migration-dev-postcheck.json) · [재사용 검사 결과](evidence/migration-dev-inspection.json)

## 실제 검증

실제 Supabase Auth에 메일 발송 없는 가상 계정2개를 만들고 비밀번호 로그인 → DEV ES256 JWKS 서명/issuer/audience → C1 활성 세션 확인을 거쳤다. private Storage bucket은 파일64KiB 제한으로 임시 생성했다. 가상 DB18/DB19 각26개 테이블을 모두 채운 표본만 업로드했다. 사용자 실제 일지나 파일은 사용하지 않았다.

1. DB18 전체 이관: 본문 없는 metadata 저장·Blob 업로드/readback·게시와 전체 봉투 재조회 일치.
2. DB19 전체 이관: ready와 게시 응답을 의도적으로 잃은 뒤 journal 재열기/사본 유실 상황에서 재조회 복구. 삭제 잠금과 전체 봉투 일치, 물리 업로드 재실행 없음.
3. DB19 취소: 게시 준비 응답 유실 뒤 cancel fence, DELETE 응답 유실 뒤 재개, 파일 부재 확인/used_bytes=0.

각 표본의 로컬 원본 hash 유지·분리된 source/target hash·논리 이미지/썸네일 참조 보존·DB data/thumb 본문0을 확인했다. 다른 계정의 이관 상태 조회와 private Storage 직접 접근도 거절됐다. 한 표본당 물리 Blob1개로 총 **3회/204bytes** 업로드했다. 업무 데이터 outbound body는 API/Auth/RPC를 포함해 총100,341bytes, 요청은 정리 포함146회였다.

**실제 기능 검증44개와 정리 확인4개 통과.** 별도 로컬 실행 guard6개도 통과했다. 앞 단계369개와는 실행 범위·시점이 다르므로 제품 완성도 수치로 합산하지 않는다. [실제 시험](evidence/migration-dev-live-check.json) · [로그](evidence/migration-dev-live-log.txt) · [요약/소스 hash](evidence/migration-dev-summary.json) · [guard 로그](evidence/migration-dev-guards.txt)

## 정리·권한·비용

시험이 만든 Auth 계정2개와 세 공간의 job/header/record/asset/IO/audit·기기·파일·bucket을 정리했다. API 재조회와 SQL로 표본 잔여0을 확인했다. 일반 앱의 취소는 metadata를 보존하며, 이번 관리자 삭제는 UUID가 고정된 이 시험 소유 fixture만 대상으로 한다. 이 정리 SQL을 사용자 공간의 삭제 경로로 사용하지 않는다.

KeepAlive job1 `0 3 * * *` UTC=한국 정오 설정은 유지했다. **2026-11-10 03:00 UTC 정규 실행 succeeded**와 heartbeat 갱신을 처음 실제 관측했다. 이전 문서의 ‘정규 첫 실행 미관측’은 과거 상태다. Free 플랜은 기존 사용자 확인을 유지하며 결제/Pro/compute/유료 옵션을 변경하지 않았다. DB 물리 크기 약12MB 조회값은 계정 청구 Usage/공식 잔여 quota로 해석하지 않는다.

읽기 검사에서 supabase_read_only_user/transaction_read_only=on이 나오는 것은 read_only:true 요청의 의도된 역할이다. 새 설치는 별도 read_only:false SELECT로 postgres/off를 확인한 뒤 실행했다. 쓰기 연결이 다시 막혔다는 의미가 아니다.005 검증 SQL의 cloudApplied:false 상수는 작성 당시 후보 metadata이며 현재 적용 여부는 실제 설치 증거와 테이블/권한 관측이 정본이다.

## 재현과 다음 단계

```sh
node --use-env-proxy poc/v2-migration/development/inspect.mjs --inspect-development
node --test poc/v2-migration/development/guards.test.mjs
```

실제 쓰기 표본 도구는 별도 `live-check.mjs --run-development-fixtures --free-usage-confirmed`이며 DEV 환경/키·설치 hash·bucket 충돌을 검사한다. 두 도구 모두 현재 DEV 변수/Secret을 쓰고 키/비밀번호/JWT를 로그에 넣지 않는다. 기존 승인된 설정으로 실행했으며 사용자에게 새 환경변수를 요구하지 않았다. 시험 도구는 제품에 포함하지 않는다.

5번의 제한된 DEV PoC 통합은 완료다. 다음은 **6번 제품 실행/저장/설정/업데이트 격리와 온라인 연결 UI 설계·구현 검토**다. native 앱·Windows/macOS 실기·제품 동기화·다국어는 아직 남았다. 파일64KiB/자산8개/전체JSON1MiB 제한과 미확정 POST의 보수적 보류도 제품용으로 확장해야 한다. receipt는 poc-verified로 제품 활성화를 계속 차단한다. 기존 로컬 모델 영구 유지·새 사본 이관 철칙은 [56문서](56-local-permanence-copy-migration.md)를 따른다.
