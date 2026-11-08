# V2 PostgreSQL 최소 명령·권한 PoC

제품 DB18·앱과 분리된 **로컬 전용** 시험이다. 실제 Supabase에는 적용하지 않는다. 공식 PostgreSQL 17 이미지의 digest를 고정하고 Python 표준 라이브러리와 Docker CLI만 사용한다. 앱 의존성·lockfile은 변경하지 않는다.

```sh
python3 poc/v2-postgres/run-local.py
```

로컬 Docker 데몬 접근이 필요하다. 이미지가 없으면 정상 Docker registry 접근으로 내려받는다. 환경에 따라 지원되는 외부 실행 권한이 필요할 수 있다. 실행 도구는 Docker 원격 endpoint/context/TLS 선택자를 제거하고 `/var/run/docker.sock`만 사용한다. 다른 Docker 설정/인증은 유지한다.

매 실행마다 임의 이름의 컨테이너를 만들고 `--network none`, 공개 포트 없음, PostgreSQL TCP 수신 없음, 메모리512MiB·CPU1·PID128·데이터 tmpfs256MiB로 제한한다. 종료 시 해당 실행이 만든 컨테이너와 그 볼륨만 제거한다. 전역 prune을 하지 않는다. 결과 JSON은 `/tmp/wjb-v2-postgres-*/results.json`에 남는다.

`bootstrap-local.sql`은 가상 `authenticated`/`anon` 역할과 Auth claims getter를 만든다. **JWT 서명·만료·issuer·audience를 확인하지 않는 시험용 stub**이다. 가상 claims를 직접 지정할 수 있는 로컬 관리자 연결로 역할별 SQL 동작을 확인한다. 이 구성이 실제 클라이언트 인증이나 SQL 직접 접근을 안전하게 제공한다는 뜻은 아니다.

`001-text-command.sql`은 별도 schema/NOLOGIN 소유자가 준비된 상황을 가정한 실험용 SQL이다. 스키마를 만든 뒤 한번 적용하며 재실행 가능한 production migration 도구가 아니다. owner 역할은 테이블 소유자로 RLS를 우회하므로 SECURITY DEFINER 내부의 계정/기기/공간 검사도 필수다. Supabase 역할·노출 스키마·migration 소유자·실제 Auth session 검증은 별도 적용 검토가 필요하다.

최소 타입은 16KiB 이하 텍스트 레코드 하나다. 생성/수정·revision CAS·generation·기기/세션 바인딩·멱등 결과·변경 로그를 검증한다. 모든 함수는 고정 `search_path`, 공개 실행 권한 제거, 명시적 client grant를 사용한다. 클라이언트 직접 DML과 내부 장부 읽기는 허용하지 않는다. PostgreSQL bigint 응답은 JSON 십진 문자열이다.

기기 행의 공유 잠금과 공간 행의 갱신 잠금을 트랜잭션 종료까지 유지한다. 공간 cursor 할당·레코드·로그·멱등 결과가 같은 트랜잭션에 속한다. 멱등 요청은 정해진 인자의 canonical JSONB 값으로 비교하며 실제 HTTP/protocol 정규화 구현은 포함하지 않는다. caller rollback 후 재시도는 새로 반영되고, 이미 commit된 요청의 재시도는 기존 결과를 돌려준다.

범위 밖: 전체 업무 도메인·삭제/복원/로그 보관·멤버십 협업·실제 Auth/PKCE·HTTP/RPC 배포·Storage RLS/파일 전송·네이티브 어댑터·클라우드 성능·비용 검증. 기존 SQLite214개 시험과 이 PostgreSQL39개 시험은 서로 다른 구현 범위다. 전체 P01~P22 통과로 합산하지 않는다.

결과와 다음 단계는 [33. 로컬 PostgreSQL 결과](../../docs/v2-design/33-local-postgres-results.md)를 따른다.

## 세션·자산 확장 시험

`npm ci --prefix poc/v2-auth --ignore-scripts --no-audit --no-fund` 후 `PYTHONDONTWRITEBYTECODE=1 python3 poc/v2-postgres/run-local.py --extended`를 실행하면 기본39개 뒤에002 SQL과49개 시험을 추가한다(총88개). 별도 Auth 소스/lockfile hash도 결과에 포함한다. 가상 서명 principal을 통한 기기 등록·앱 세션 회수·비공개 자산 예약/확정/취소·실제 bytes hash/크기·RLS·quota 경합을 검증한다. 자산 bytes는 로컬 bytea 시험 테이블이며 Supabase Storage가 아니다. 실제 Auth 상태 확인·클라우드 Storage·문서 참조/자산 GC는 후속이다. [34문서](../../docs/v2-design/34-auth-private-assets-results.md)를 따른다.

## 클라우드 후보 SQL·복구 시험

`PYTHONDONTWRITEBYTECODE=1 python3 poc/v2-postgres/run-local.py --extended --cloud`는 기존88개 뒤에 C1 후보39개를 실행한다(총127개). Auth 테이블은 로컬 fixture이며 실제 managed Auth가 아니다. 후보/복구 SQL·readiness 소스 hash도 증거에 포함한다. 대상 프로젝트에는 적용하지 않는다. [클라우드 검토 묶음](../v2-cloud/README.md)을 따른다.
