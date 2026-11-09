# 48. 온라인 이미지 Blob 저장소·무료 용량 비교

2026-11-09 UTC · v2-design · 공식 공개 원문 조회 기반 후보 검토. 가입/카드 등록/버킷 생성/유료 활성화/파일 전송은 하지 않았다.

## 요구사항과 결론

온라인 이미지는 **비공개 Blob/객체 저장소**에 binary로 저장하고, DB에는 자산 ID/hash/소유권/참조/실물 byte수만 저장한다. Blob이라는 용어를 Vercel Blob 상품으로 한정하지 않는다. Supabase DB/Auth와 다른 공급자의 객체 저장소 조합도 가능하도록 설계한다. 기존 V1/로컬 전용 모델은 변경하지 않는다([46문서](46-local-compatibility-image-storage.md)).

무료 저장 용량 관점의 **우선 검증 후보는 Cloudflare R2 Standard**다. 하지만 월0원/아시아 요구를 모두 충족했다고 확정하지 않는다. 무료 초과 과금과 아시아 저장 위치 보장 미확인이 채택 전 조건이다. 기존 Supabase Storage 구현을 지금 R2로 교체하거나 비용/리전 정책을 자동 완화하지 않는다.

## 공개 원문에서 확인한 비교

| 후보 | 무료 저장/전송 확인 | 연동·주의 | 판단 |
|---|---|---|---|
| Cloudflare R2 Standard | 10GB-month/월, Class A100만·B1,000만/월, R2 인터넷 egress 무료 | private bucket·S3-compatible/Workers API. 초과분 과금·subscription checkout 필요. 개발/운영 bucket을 만든다고 무료 한도가 각각 생긴다고 가정하지 않음 | 용량/전송 비용 우선 검증 후보 |
| Supabase Storage Free | Storage1GB·egress5GB 공개 포함량, 기본 조직 합산 | DB/Auth 통합·지정 프로젝트 리전. 이미지 변환은 Free 미포함. 개발/운영 프로젝트가 조직을 공유하면 포함량도 합산 검토 | 운영 구성 단순성/리전 비교 기준 |
| Backblaze B2 | 이번 실행에서 현행 공식 가격표 직접 확인 못함 | 비공개/S3-compatible 비교 후보. 무료 저장·egress·요청 수·리전·결제수단/차단 조건 확인 필요 | 2차 조사. 미확인 수치를 확정 비교에 넣지 않음 |
| Vercel Blob | 기존 사용자 사례의 1GB 기록은 과거 snapshot이며 현행 보장값 아님 | private 저장/다운로드·Hobby 사용 조건·요청/transfer 합산 재검증 필요. 기존 공개 URL 구현은 업무 자료에 재사용하지 않음 | 기존 경험 재사용 후보. 무료 대용량 우위 미확인 |

R2 **10GB-month는 월 평균 저장량의 과금 단위**이며 매월 누적10GB를 추가 제공한다는 뜻이 아니다. Infrequent Access에는 위 무료 tier가 적용되지 않으므로 기본 후보에서 제외한다. 공개 원문은 R2 Standard 초과 저장 $0.015/GB-month, A $4.50/100만 회, B $0.36/100만 회와 과금 단위 올림을 명시한다. 현재 계정의 결제/약관/잔여량은 별도 확인한다.

B2 공식 pricing 호스트는 현 환경 proxy에서403으로 접근 불가였다. 공식 Backblaze SDK/CLI README는 조회했으나 최신 무료 한도/전송 조건의 근거가 없어 과거 알려진 수치를 확정값으로 쓰지 않았다. 다음 조사 시 해당 공식 사이트 접근 또는 사용자 콘솔 조건으로 보완한다. Vercel은18문서의 기존 사례를 참고 후보로 유지하며 현행 요금 검증 완료로 표시하지 않는다.

## 리전 조건의 중요 차이

R2 공식 Data location 문서는 apac 위치 힌트를 지원하지만 **best effort이며 guarantee가 아니라고 명시**한다. 확인한 jurisdiction 목록은 EU/US/FedRAMP이고 아시아 고정 보장의 근거는 확인하지 못했다. 초기 아시아 운영 원칙을 엄격한 이미지 저장 위치 요건으로 적용하면, 현재 R2 근거만으로 충족 판정할 수 없다. 계정/콘솔·공급자 조건으로 확인하거나 별도 요구 검토가 필요하다. 용량이 크다는 이유로 지역 요구를 묵시적으로 바꾸지 않는다.

## 조합 아키텍처

```text
V2 온라인 클라이언트 → 인증된 자산 gateway → private Blob 저장소
                           ↓
                   Supabase Auth/DB
          (소유권·회수·quota·blob/참조 metadata)
```

Supabase DB/Auth와 Blob 공급자를 분리하고 AssetStore adapter를 둔다. DB에는 승인된 storeId + opaque objectKey를 기록한다. 사용자가 입력한 URL로 서버가 임의 다운로드하지 않게 하며 저장소 access key/서명 URL을 문서에 영속 저장하지 않는다. dev/prod는 bucket·쓰기 자격증명·storeId/관측을 분리한다. 현재 Supabase 전용 adapter와 reservation/verify/cleanup/recovery 계약의 공급자별 동작을 재시험해야 한다.

우선 검증은46문서의 서버 proxy 모델을 유지한다. R2+Workers 자산 gateway 조합은 후보이며 현재 PostgreSQL/JWT/세션 어댑터가 Workers에 그대로 배포된다고 가정하지 않는다. **R2 egress 무료는 전체 서비스 egress 무료와 다르다.** Supabase Edge를 통해 모든 이미지 bytes를 중계하면 Supabase egress가 추가될 수 있고, 별도 Workers 경로도 실행/CPU/요청/JWT/권한 재확인 비용이 있다. 전체 전송 경로를 재설계·계측해야 한다.

R2의 S3-compatible API 사용은 AWS 직접 인프라 운영을 뜻하지 않는다. AWS 직접 구성 제외 원칙은 유지한다. 단순히 공개 bucket/r2.dev URL을 켜서 인증 gateway 비용을 피하는 구조는 비공개 업무 자료 요구를 충족하지 않는다.

## 월0원 유지 조건

무료 tier는 자동 초과 차단 보장이 아니다. 가입 시 checkout/결제수단 요구·구독 과금·계정 합산량·다른 앱/개발 bucket 사용량을 먼저 확인한다. 결제 등록/유료 활성화가 필요한 조치는 사용자가 별도 판단한다.

- 저장 용량/각 작업 종류/전송/호출 실행비를 별도 한도로 관리한다. 예비 설계값은 확인된 무료 한도의70% 경고·80% 신규 업로드 예약 중단이며 계정 합산 여유/복원 피크를 별도로 남긴다. 실제 계정 여유가 적으면 더 낮춘다.
- 동시 예약·미확정 I/O·중복 업로드 대기·썸네일·snapshot/충돌 사본·이관 중 이중 저장을 계산한다. 일일 usage 조회만으로 실제 과금 상한을 보장하지 않는다.
- 인증 전 요청·LIST/HEAD 반복·실패 재시도도 공급자 과금 규칙과 남용 가능성을 검증한다. 인증/RPC·rate limit·bounded retry·캐시로 제한한다. R2의 일부 실패 요청도 과금될 수 있다.
- 앱 내부 제한은 제공자 계정의 외부 사용/모든 공격/과금 집계 지연을 완전히 통제하지 못한다. **월0원 절대 보장으로 광고하지 않는다.** 공급자 강제 cap/결제 정책을 확인하고 미확인 상태의 유료 활성화는 하지 않는다.
- 온라인 신규 업로드를 멈춰도 기존 로컬 읽기·작성·내보내기·백업은 계속 가능해야 한다. 공간/자료를 지워 무료 한도를 맞추는 자동 정책은 두지 않는다.

400KiB 처리본+50KiB 미리보기450KiB를 기준으로 단순 나누면1GB는 약2,170개,10GB는 약21,700개다. 이는 십진 용량/이진 KiB의 **이론상 실물 수**이고 metadata·공유/삭제·snapshot/유예·개발 합산·여유분을 제외한 수치다. 실제 수용량 약속이 아니다. 해시 중복 제거와 표시본 재사용이 함께 적용돼야 반복 복제의 실물 증가를 막을 수 있다.

## 다음 검토/실행 항목

1. R2 무료/checkout/강제 cap·실제 계정 합산량/아시아 보장 조건 확인. B2/Vercel 공식 요금/지역/비공개 조건 추가 확인.
2. 저장소 선택 전 같은 가상 이미지셋으로 byte 절감·쓰기/HEAD/읽기 수·다운로드 경로·추정 월비용을 비교한다. 무료 용량 단독 순위로 선택하지 않는다.
3. provider별 private 권한·원자적 업로드/중복 예약·실물 hash 검증·취소/timeout/복원·GC를 로컬 대체 서버 후 개발 환경에서 검증한다.
4. 선택 후46문서 blob/reference schema와 storeId 연결·환경 Secret/호스트·개발/운영 bucket 정책을 별도 검토한다. 현재 DB-only 승인 묶음에 자동 포함하지 않는다.

원문/조회 상태/본문 hash·발췌는 [조사 증거](evidence/blob-provider-research.json)에 보존한다. 제품 코드/DB18/main/환경/계정·버킷은 변경하지 않았다.

## 후속 비용/지역 판단(2026-11-10 KST)

[53문서](53-blob-selection-and-verification-plan.md)에서 공식 cost-control/regions/Workers 문서를 추가 확인했다. Supabase Free는 과금하지 않으며 Spend Cap은 Pro 전용이다. 기존 용량 우선 R2 후보와 구분해 월0원·아시아 유지 초기안은 Supabase private Storage를 제안한다. R2는 아시아 힌트 허용 여부/초과 과금 조건 결정 전 미선정이다. 현재 DEV/운영 예정 조직은 서로 달라 포함량을 무조건 합산하지 않는다. 실제 계정 Free/Usage·공급자 선택·파일 전송은 남는다.
