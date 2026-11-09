# PostgreSQL 이관 서버 검토 모듈

```sh
PYTHONDONTWRITEBYTECODE=1 python3 poc/v2-migration/postgres/run-local.py
```

공식 digest 고정 PostgreSQL17 컨테이너, network none/포트 없음/CPU1/512MiB/tmpfs256MiB로 시험한다. Docker selector를 제거한 고정 local socket만 쓰며 Supabase 키를 하위 실행 환경에서 제외한다. 기존 이미지가 없으면 이 도구는 실패하고 자동 외부 서비스/DB를 선택하지 않는다. 종료 시 자신의 컨테이너만 제거한다.

001은 C1/C2 뒤의 **새 전진 검토 SQL**이다. 기존 install.sql을 수정/재실행하지 않는다. 000은 SELECT preflight,002는 SELECT 권한/객체 확인,003은 사용 이력이 없는 새 모듈의 빈 상태 rollback이다. 사용 중인 job이 있으면 rollback은 거절되며 데이터를 삭제하지 않는다. 어떤 스크립트도 개발/운영 Supabase에 자동 적용하지 않는다.

새 private schema3테이블/RLS, server role 전용 RPC1개, private helper5개와 기존 asset 테이블의 새 workspace 한정 INSERT gate1개를 만든다. 노출된 클라이언트 RPC/직접 DML은 없다. gateway attestation은 실제 bytes readback/삭제 부재 확인을 수행한 trusted server만 호출해야 한다. SQL만으로 외부 Blob bytes를 읽었다고 간주하지 않는다.

**migration-document-poc-1은 문단/이미지 참조만 지원한다.** 실제 DB18 전체 도메인 매핑이 아니며, 완료 증표 status=poc-verified는 앱의 verified 조건을 통과하지 못한다. 실제 Auth/JWT/Storage는 가상/신뢰 어댑터 경계로 대체하며 이번 시험의 범위를 분리한다.

정본: [59. 결과/검토 범위](../../../docs/v2-design/59-postgres-migration-server.md)
