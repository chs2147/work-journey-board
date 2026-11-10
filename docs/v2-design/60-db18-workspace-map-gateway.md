# 60. DB18 전체 메타데이터 매핑·이관 RPC 연결

2026-11-10 UTC · v2-design · 앱1.23.3/DB18 유지 · 독립 PoC

## 완료 범위

`poc/v2-migration/workspace-map.mjs`는 원본 DB가 아니라 검증된 새 사본만 읽는다. DB18 스키마 계약26개 테이블의 열·타입·기본 키·외래 키·행 수를 확인하고 `workspace-db18-map-poc-1` 봉투를 만든다. 테이블별 원본/매핑/제외/변환 행 수와 제외 사유를 남긴다. 계약은 `build-db18-contract.mjs`가 메모리 DB에서 생성하며 사용자 DB를 열지 않는다.

업무·완료·반복·태그·메모·Cabi.NET 노트와 표/계층번호/글자색·보드 배치/관계/Live Widget·Universe·지식 자료·가져오기 취소 이력을 보존한다. 논리 이미지와 썸네일 항목의 ID/소유 관계는 유지하고 본문은 Blob 참조로 표현한다. 같은 파일을 공유해도 논리 항목을 합치지 않는다.

기기 전용 UI/백업/AI 설정은 값 없이 제외 사유를 기록한다. 폴더 연결의 경로는 제거하고 `device-local-unbound`로 표시한다. 가져오기 파일명은 basename만 남긴다. 업무 본문에 사용자가 작성한 경로 문장은 보존한다. 알 수 없는 설정·문서 종류·객체 형식·참조 오류는 조용히 누락하지 않고 실패한다.

## 신뢰 경계와 두 해시

`server-rpc.mjs`는 이미 인증된 principal을 받는 서버 전용 DEV 어댑터다. JWT 검증 자체를 대체하지 않는다. DEV RPC 목적지와 액션/인자/응답 형식·크기·시간을 제한하고 redirect 및 상세 내부 오류 노출을 차단한다. 실제 서비스 키를 시험에 사용하지 않는다.

원본 사본의 `sourceManifestHash`와 PostgreSQL JSONB 직렬화의 `manifestHash`는 서로 다른 바이트의 해시다. `bindMigrationManifests`는 job/workspace/source 일치를 확인하고 두 값을 별도로 묶는다. SQL start/replay/status 응답에 workspace/source 식별자를 추가했다. journal에 이 이중 바인딩을 영속 연결하는 작업은 아직 남았다.

## 검증과 증거

- 전체26개 테이블에 자료를 넣은 합성 DB18 매핑17개.
- 실제 loopback HTTP로 RPC 경계16개.
- 실제 PostgreSQL17.11의 권한/경쟁/취소/원자적 게시 등40개. 새 시험은 HTTP→RPC 어댑터→실제 SQL 함수까지 연결한다.
- 기존 journal32개·실행 격리29개·사본 추출23개·DB18회귀19개를 포함한 JavaScript136개와 PG40개, 총176개 통과. [회귀 집계](evidence/migration-map-gateway-regression.json) · [JS 실행 로그](evidence/migration-map-gateway-js.txt).

[새 PostgreSQL 실행 증거](evidence/migration-map-gateway-postgres-pass.json). 이전59문서의39개 증거는 당시 기록으로 보존한다. 테스트는 가상 사용자/자료·임시 사본·로컬 컨테이너만 사용하며 자기 컨테이너를 제거한다. 이번 단계의 실제 Supabase/Storage 변경은 없다.

## 구현되지 않은 연결과 다음 단계

전체 매핑 봉투는 기존 최소 문서 서버 프로필 `migration-document-poc-1`과 호환되지 않는다. RPC 어댑터는 전체 봉투를 최소 형식으로 축약하지 않고 전송 전에 거절한다. 현 서버의8개 자산/자산당64KiB 등 PoC 제한도 그대로다. 원본 이미지를 제한에 맞춰 몰래 변경하거나 누락하지 않는다. 현재 `productActivationAllowed=false`, 서버 증표 `poc-verified`로 제품 워크스페이스를 활성화할 수 없다.

다음 순서는 **전체 봉투를 검증·저장할 서버 프로필/전진 SQL 확장 → journal의 source/target 해시 영속 바인딩 → 실제 Storage readback/취소 부재 확인 어댑터 연결 → DEV 통합 검토**다. native 앱 연결/다국어/실기/제품 배포는 후속이다. 기존 설치 SQL 재실행 및 원본 로컬 구조 변경은 금지한다. 로컬 영구 유지와 새 사본 이관 철칙은 [56문서](56-local-permanence-copy-migration.md)를 따른다.
