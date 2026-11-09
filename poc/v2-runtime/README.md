# V2 실행 격리 독립 PoC

제품이 호출하지 않는 순수 계약/검사 모듈이다. 환경변수/설정 자동 읽기·클라우드 초기화·서버 배포·파일/레지스트리 쓰기를 하지 않는다. 신규 온라인 앱의 이름/식별자는 후보이며 실제 native 앱 등록은 아니다.

```sh
node poc/v2-runtime/isolation.test.mjs
node poc/v2-assets/connected-copy.test.mjs
```

local mode는 로컬 어댑터만 호출한다. connected mode는 별도 형식/프로필과 신뢰된 서버 검증 callback이 필요하다. local READY/클라이언트 boolean을 온라인 활성화 증거로 쓰지 않는다. callback의 실제 서버 RPC는 후속 단계다.

원본 공간과 온라인 사본의 경로 겹침 검사는 connected-copy에서 실제 호출한다. Windows/macOS 경로 문자열 시험은 Linux에서 수행했으므로 native 설치/파일시스템 실기를 대신하지 않는다. 기존 로컬판의 업데이트 피드에는 온라인 RC도 게시하면 안 된다.

정본: [57. 실행 격리·이관 완료 연결](../../docs/v2-design/57-runtime-isolation-and-migration-handoff.md), [56. 로컬 영구 유지 철칙](../../docs/v2-design/56-local-permanence-copy-migration.md).
