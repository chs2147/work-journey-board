# 온라인 사본 이관의 영속 journal PoC

```sh
node poc/v2-migration/coordinator.test.mjs
```

합성 DB18→별도 metadata/이미지 파일 사본→작업 journal→테스트 서버 port 흐름을 검증한다. journal은 ID/hash/정수 크기/상태만 저장하며 이미지 본문/인증 키를 넣지 않는다. 원본 로컬 폴더와 겹치는 위치/기존 DB18/alias를 쓰기용으로 열지 않는다.

원격 port는 trusted adapter 계약이며 실제 Supabase migration RPC가 아니다. observe의 operationSettled를 단순 HEAD/timeout에서 추측하지 않는다. publish/cancelStaging은 실제 서버에서 원자적으로 구현해야 한다. 취소/기게시 재조회는 파일 유실 시에도 가능하고 업로드에는 검증한 사본이 필요하다.

시험은 새 임시 폴더와 가상 자료만 쓰고 종료 시 그 폴더를 정리한다. SIGKILL 시험은 생성한 Linux 자식 프로세스만 대상으로 한다. 제품/실제 사용자 DB/Cloud에는 연결하지 않는다.

[58. 결과/상태/서버 계약](../../docs/v2-design/58-durable-migration-resume-cancel.md) · [56. 로컬 영구 유지 철칙](../../docs/v2-design/56-local-permanence-copy-migration.md)
