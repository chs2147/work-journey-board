# 54. 온라인 Blob 저장소 Supabase 확정

2026-11-10 06:35 KST · v2-design · 사용자 결정: “수파베이스로 우선 확정”

## 확정 사항

V2의 첫 온라인 이미지/첨부 저장소는 **Supabase 비공개 Storage**로 확정한다. DB/Auth/Storage를 Supabase로 구성하고 이미지 실물은 Storage에 binary로 저장한다. PostgreSQL에는 자산 ID/hash/실물 bytes/소유권/참조/상태를 저장한다. R2/B2/Vercel 가입·연동은 초기 진행 항목에서 제외하고 비교 기록만 보존한다.

사용자의 공급자 선택은 Pro 결제/업그레이드 승인이 아니다. 기존 월0원 예산을 유지하며 현재 실제 플랜을 확인한다. Free1GB로 시작할 수 있는지 사용량을 확인하고, 부족하면 Pro100GB 전환을 별도 결정한다. 플랜 변경을 위해 제품 데이터 형식/자산 ID를 바꾸는 구조로 만들지 않는다. Pro의 $25/월부터 가격에는 프로젝트 컴퓨팅 등 별도 비용이 더해질 수 있으며 이 문서에서 자동 결제를 진행하지 않는다.

Supabase의 프로젝트 특정 지역을 이용하므로 기존 DEV 서울·운영 예정 도쿄 기준을 유지한다. R2 위치 힌트 허용 여부에 관한 질문은 현재 공급자 선택의 선행 조건에서 해소됐다. Supabase 선택 자체가 모든 보조 처리/백업의 규제상 지역 보장이라는 뜻은 아니다.

## 실제 개발 대상 읽기 점검

[증거](evidence/supabase-storage-selection-preflight.json)에 현재 환경 readiness/current·개발 ref 확인 후 얻은 읽기 전용 결과를 기록했다.

| 항목 | 실제 결과 |
|---|---|
| 개발 ref | vsphftnmfzfoufasjttd |
| Storage bucket 목록 API | HTTP200 |
| 기존 bucket / object 수 | 0 / 0 |
| object metadata 크기 합계 | 0bytes |
| storage.objects RLS | true |
| storage.objects policy 수 | 0 |
| 계획 PoC bucket 동명 충돌 | 없음 |

metadata0bytes는 **프로젝트 카탈로그 합계**다. 조직의 청구 Usage/무료 잔여량/플랜 확인을 대신하지 않는다. 기존 조직 관리 조회403은 권한이 바뀌지 않아 반복하지 않았다. 운영 예정 프로젝트를 조회/수정하지 않았고 버킷/파일/정책을 만들지 않았다.

## 다음 사용자 확인: U07

환경변수나 HTTP 시크릿을 새로 입력하는 작업이 아니다. **Supabase 대시보드에서 읽어서 확인**할 항목이다. 게시 버튼도 필요 없다.

1. 개발 프로젝트 [대시보드](https://supabase.com/dashboard/project/vsphftnmfzfoufasjttd)를 선택한다.
2. 프로젝트가 속한 개발 조직 eiwuipccqtdqajvnuewx의 Billing에서 현재 **Free/Pro** 플랜을 확인한다. 운영 예정 조직의 이전 Free 확인을 재사용하지 않는다.
3. 같은 조직의 Usage에서 **Storage Size / Egress** 사용량과 해당 청구 기간을 확인한다. Database Size와 Storage Size는 다르다. 모바일에서 메뉴가 안 보이면 브라우저의 데스크톱 사이트 보기로 전환한다.
4. 플랜 이름과 표시된 사용량/기간만 알려준다. 키/비밀번호/토큰은 보내지 않는다.

Free라면 Spend Cap 메뉴를 찾아 설정하거나 이를 위해 업그레이드하지 않는다. 공식 원문상 Free는 과금하지 않지만 무료 초과 사용 제한은 발생할 수 있다. Pro라면 실제 사용량/조직 전체 예산과 Spend Cap 적용 범위를 다시 확인하며 기존 월0원 전제를 자동 유지했다고 가정하지 않는다.

## 다음 구현·검증 범위

53문서의 범위를 Supabase 전용으로 좁힌다. U07 확인 후 DEV에서만 private PoC bucket wjb-v2-poc-private을 생성하고, 52문서와 동일한 메일 없는 임시 계정/기기/공간을 이용해 인증된 gateway 경유 예약·전송·조회·삭제·회수/격리를 검증한다. 기존 동명 bucket이 있으면 중단하고 소유권 확인 없이 재사용/삭제하지 않는다. 개발/운영은 서로 다른 프로젝트 bucket과 서버 Secret으로 분리한다.

현재 어댑터가 application/octet-stream을 사용하는 점을 시험 bucket의 MIME 제한과 맞춰야 한다. 표본은 가상 PNG/WebP/텍스트 각64KiB 이하, 전체192KiB 이하이고 API 호출/재시도 횟수도 제한한다. private bucket만으로 서버 service_role의 소유권 검사를 대체하지 않는다. 일반 사용자/무인증의 직접 접근을 막고 서버는 사용자 JWT→세션→공간/기기 권한을 재검사한다.

DB 예약만 성공한52문서와 실제 bytes 전송/무결성·삭제 확인을 분리해 보고한다. 예외/응답 유실 시 무조건 재업로드하거나 quota를 반환하지 않고 현재 상태를 조회해 복구한다. 완료 후 생성한 테스트 객체/계정/metadata/bucket의 부재를 확인한다. 기존 install.sql은 재실행하지 않는다.

제품용 이미지 압축·workspace별 hash dedup/논리 참조·삭제 유예/GC·quota·장기 오프라인 동기화는 여전히 별도 구현 항목이다. V1/기존 로컬 전용 앱·DB18·이미지 처리·백업에는 영향이 없도록 유지한다. main/제품 버전·환경 설정/유료 플랜은 변경하지 않았다.
