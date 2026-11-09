# 55. Supabase private Storage 실제 전송·복구 검증

2026-11-10 06:54 KST · v2-design · 앱1.23.3/로컬 DB18 유지

## 사용자 Free/Usage 확인 완료

사용자가 제공한22492.jpg 화면에서 Work Journey Board (DEV), Free Plan, Current billing cycle, Storage Size0/1GB, Egress0/5GB(<1%), Cached Egress0/5GB를 확인했다. [확인 기록](evidence/development-free-usage-user-confirmation.json)에 출처/첨부 hash를 남겼다. 정확한 청구 시작/종료일은 화면에 없고 표시0은 반올림 가능성이 있으므로 실제 byte0/잔여량 정밀 측정으로 해석하지 않는다. 영상 오버레이 등 무관한 화면 내용은 저장소에 복사하지 않았다.

개발 U07은 사용자 대시보드 근거로 완료했다. 조직 Management API403이 해결됐거나 API entitlement 조회가 성공했다고 기록하지 않는다. Pro 업그레이드/결제/환경 게시/새 Secret 입력은 수행하지 않았다.

## 실제 개발 검증 결과

[실행기](../../poc/v2-cloud/development/storage-live-check.mjs)는 DEV 고정 ref와 명시적 플래그를 요구한다. Node의 --use-env-proxy로 기존 Cloud proxy/CA를 사용하고, 실제 개발 Auth/JWKS/세션·metadata RPC·Supabase Storage를 연결한 gateway를 **127.0.0.1에만** 열었다. 인터넷 공개 호스팅이나 제품 앱 연결은 하지 않았다.

| 실제 시험 | 결과 |
|---|---|
| private bucket 생성/조회 | public=false, max65536bytes, application/octet-stream |
| 가상 PNG68bytes/WebP42bytes/UTF-8한글56bytes | 합계166bytes, 예약·전송·다운로드/해시 일치 |
| 동일 업로드 재시도 | ready 유지, 실제 객체3개로 유지 |
| PNG 업로드 저장 성공 후 응답 유실 주입 | 최초503, 중복 실물 검증 후 안전하게 재시도 성공 |
| UTF-8 최종 공개 상태 전환 전 RPC 실패 주입 | pending 유지, 실제 recovery preview/RESTORE_READY로 복구 |
| 다른 계정의 정상 JWT/기기로 본인 공간 파일 조회 |403 |
| 일반 사용자 JWT의 Storage 직접 조회/공개 URL 접근 | 모두 거절 |
| 무인증 gateway·잘못된 hash |401 /409 |
| 없는 pending 파일 취소 | 부재 확인 후 canceled/예약량 반환 |
| 여유100bytes에80bytes 동시 예약2개 |201 한 건/409 QUOTA_EXCEEDED 한 건 |
| 성공한 예약 취소 후 | used_bytes가 직전 값으로 복귀, quota 이하 |
|65537bytes 예약 |400 |
| 서버 세션 회수 후 다운로드 |403 |

총47개 실제 검사가 통과했다. 완료된 [실행 증거](evidence/development-storage-live-check.json)는 원격 요청144회·Storage POST4회를 기록한다. outboundBodyBytes는 원격 요청 본문의 합계이며 청구 Egress나 실제 총 네트워크 bytes가 아니다. 순수 파일 크기가 작은 테스트라 제품용 화질·대용량/장기 부하·OS별 성능의 근거로 쓰지 않는다. 장애 주입은 transport에서 응답 유실/공개 전환 실패를 재현한 것이며 공급자 실제 장애를 유발한 것은 아니다.

## 실제 API 차이 수정

첫 실행은 없는 파일 취소에서503으로 실패했고 [첫 시도](evidence/development-storage-live-attempt1.json)에 남겼다. [집중 조회](evidence/development-storage-missing-object-probe.json)에서 Supabase가 파일 부재를 다음처럼 반환하는 것을 확인했다.

```json
{"http":400,"body":{"statusCode":"404","error":"not_found","message":"Object not found"}}
```

[supabase-rest.mjs](../../poc/v2-gateway/supabase-rest.mjs)는 이 정확한 조합을 기존 HTTP404와 함께 OBJECT_MISSING으로 처리한다. 다른400/403·bucket 없음·잘못된 코드·미지의 error·깨진/4096bytes 초과 본문은 STORAGE_UNAVAILABLE로 유지한다. 서버 권한 오류를 파일 부재로 오인해 quota를 반환하지 않도록7개 회귀를 추가했다.

관련 로컬 검사: gateway68(기존61+신규7), 개발 조합10, 복구25, metadata14, Auth28+세션11 = **156개 통과**. 기존 Docker 영속41개와 제품 전체 단위/UI 검사는 이번 PoC 변경에서 재실행/합산하지 않았다.

## 데이터 정리와 안전 범위

최종 실행에서 생성한 private 객체/버킷·Auth 계정2개·workspace/device/asset/io_intent/recovery_audit/blocked_session을 정리했다. 실물 metadata0, bucket 부재, 시험 metadata잔여0, Auth 사용자 조회404를 확인했다. 첫 실패 실행과 집중 조회의 버킷도 정리 완료다. 삭제는 이번 실행이 생성한 UUID/전용 bucket에 한정하며 사전 동명 bucket이 있으면 중단한다. 생성 응답이 불확실하면 기존 자원을 임의 인수/삭제하지 않고 정리 식별자를 남긴다.

제품에서 ready 자산을 사용자가 삭제하는 API를 새로 구현한 것은 아니다. 이번 pending 취소는 gateway로, 시험용 ready 실물 정리는 서버 Storage API로 수행했다. 이 차이를 사용자용 삭제/참조 GC 완성으로 표시하지 않는다.

```sh
node --use-env-proxy poc/v2-cloud/development/storage-live-check.mjs \
  --run-development-fixtures --free-usage-confirmed
```

재실행 전 current readiness/DEV ref/현재 Free·사용량·동명 충돌을 다시 확인한다. 이 명령은 실제 개발 Auth/Storage/시험 metadata를 생성/제거하므로 자동 CI/스케줄/앱 시작에 연결하지 않는다. 신규 생성할 표본은 각64KiB/합계192KiB 이하, 원격 요청/쓰기 횟수 제한이 있다. cleanup은 일반 요청 예산 초과 시에도 생성 자원을 정리할 수 있도록 별도 경로로 실행한다. 키/암호/JWT/refresh token은 로그/Git에 기록하지 않는다.

기존 install.sql·운영 예정 DB·KeepAlive·V1 제품·DB18·환경 설정/네트워크/유료 플랜은 변경하지 않았다. A05 중 개발 Auth/private Storage/loopback gateway까지 실증됐으며 공개 호스팅·실제 제품/기기 동기화는 남는다.

## 다음 단계

1. **A06:** V1/V2 앱 ID·설정 폴더·업데이트 피드·원본 복사 경계를 구체화/검증한다. 기존 로컬 전용 앱에 로그인/클라우드 의존을 추가하지 않는다.
2. **A07/A08:** 제품용 binary 자산/논리 참조·workspace hash dedup·GC·이미지 품질/해상도 비교 PoC를 진행한다. 현재64KiB·assetId 저장 계약은 이 기능들의 완성이 아니다.
3. 서버 배포 방식/네이티브 로그인·실제 기기 동기화/충돌·ko/en 이행과 Win/macOS 검증을 순서대로 연결한다. 초기 Supabase private Storage 선택은 유지한다.
