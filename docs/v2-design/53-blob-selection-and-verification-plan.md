# 53. Blob 저장소 선택안·무료 운영 예산·실전 검증 계획

2026-11-10 KST · v2-design · 검토 단계. 공급자 선택/계정/구독/버킷/실제 파일 전송은 아직 수행하지 않았다.

## 추천안

**현재 월0원·아시아 원칙을 유지한 초기안은 Supabase Free private Storage**, 무료 용량 확장안은 **Cloudflare R2 Standard**로 제안한다. Supabase의1GB가 충분한지 이미지 실제 크기/누적량으로 판단하고, R2는 아시아 위치 힌트 허용 여부와 checkout/초과 과금 조건을 확인한 뒤 선택한다. 48문서의 ‘용량 우선 R2 후보’를 비용/지역 조건까지 확장한 판단이다. 최종 공급자는 아직 확정하지 않았다.

사용자에게 아시아 조건이 저장 위치 보장인지 성능상 위치 힌트 허용인지 확인을 요청했다. 답변 전에는 기존 조건을 유지한다. 아시아 원칙을 자동 완화하거나 R2 구독/결제 등록을 진행하지 않는다.

| 판단 기준 | Supabase Free Storage | R2 Standard + Workers Free 후보 |
|---|---|---|
| 공개 무료 저장 포함량 | 조직1GB | 계정10GB-month |
| 공개 전송 조건 | Egress5GB. DB/Auth/Storage/Edge 등 다른 서비스 전송과 함께 검토 | R2 인터넷 egress 무료. Supabase 인증/RPC 전송과 gateway 실행은 별도 |
| 무료 초과/과금 | 공식 cost-control 문서: **Free 사용 중 과금하지 않음**. 사용 제한/가용성 저하 가능, 무제한이 아님 | R2는 포함량을 넘으면 사용량 과금. Workers Free와 R2 과금은 별개 |
| 지역 | 특정 프로젝트의 primary region을 선택. DEV 서울/운영 예정 도쿄는 이전 실제 관측. 규제 준수 전체 보장과는 구분 | apac은 best effort 힌트. 아시아 보장 근거 없음 |
| 준비 난도 | 기존 Auth/DB/서버 키 활용 가능. private bucket/권한/잔여량 검증 필요 | R2 checkout·별도 자격증명/네트워크·Worker 호환성·전체 비용 검증 필요 |
| 현재 판단 | 작은 초기 규모·월0원 조건에 우선 검토 | 공간/전송 확장에 유리하지만 지역/과금 조건 결정 전 보류 |

Supabase의 Spend Cap은 **Pro 전용**이다. Free 계정에서 Spend Cap 메뉴를 찾아 켜거나 이를 위해 Pro로 전환할 필요가 없다. R2의 경고/앱 업로드 제한을 공급자 강제 청구 상한으로 설명하지 않는다. R2의 범용 강제 지출 상한은 이번 공식 원문에서 확인하지 못했다.

현재 개발 조직 eiwuipccqtdqajvnuewx와 운영 예정 조직 uouvvszpwsgdwkbhvtkz는 서로 다르다. ‘같은 조직 내 프로젝트의 포함량 합산’ 규칙을 이 두 조직에 그대로 적용하지 않는다. 각 조직의 실제 Free 플랜/Usage를 따로 확인해야 하며 개발 U07은 미완료다. 프로젝트2개가 있다고 한 조직의 Storage 포함량이2GB가 되는 것도 아니다.

Supabase 내부 인프라의 AWS region 명칭은 공급자 지역 식별이다. 직접 AWS 인프라를 구축/운영하는 선택은 계속 제외한다.

## 새로 확인한 공식 근거

공개 공식 저장소의 원문을 새로 조회하고 HTTP 상태·SHA256·발췌를 [후속 조사 증거](evidence/blob-provider-followup-research.json)에 저장했다. 문서의 공개 포함량은 실제 계정 계약/잔여량의 검증 결과가 아니다.

- [Supabase 비용 제어](https://supabase.com/docs/guides/platform/cost-control): Free 과금 없음, Spend Cap은 Pro만 제공.
- [Supabase 요금 구조](https://supabase.com/docs/guides/platform/billing-on-supabase): 조직 단위 포함량, Storage1GB/Egress5GB.
- [Supabase 지역](https://supabase.com/docs/guides/platform/regions): primary region과 특정 지역 선택, 지역 선택 자체가 규제 준수 증명은 아님.
- [Supabase Egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress): DB/Auth/Storage/Edge Functions 등의 전송량을 고려.
- [Supabase private bucket](https://supabase.com/docs/guides/storage/buckets/fundamentals): private 기본값, 공개 bucket은 파일 조회 접근 제어를 우회.
- [R2 요금](https://developers.cloudflare.com/r2/pricing/): Standard10GB-month, A100만/B1,000만 회, 인터넷 전송 무료. GB-month는 일별 최대 저장량의 월 평균 기준이며 무료 tier는 Infrequent Access에 미적용.
- [R2 시작](https://developers.cloudflare.com/r2/get-started/): checkout으로 구독 추가, 월 사용량 과금.
- [R2 위치](https://developers.cloudflare.com/r2/reference/data-location/): 위치 힌트는 보장이 아님.
- [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/): Free10만 요청/일, 호출당 CPU10ms. 월 합계가 작아도 일별 한도와 JWT/해시 처리 CPU를 실제 측정해야 한다.

Backblaze B2는48문서의 공식 가격표 접근 차단 상태를 현재 검증 완료로 바꾸지 않았다. Vercel 현행 가격표도 이번 네트워크에서 조회하지 못했다. 미확인 후보를 ‘더 큰 무료 용량이 확정된 대안’으로 순위에 넣지 않았다. 이번 조사를 위해 환경 호스트/Secret/게시를 변경하지 않았다.

## 이미지 용량·복원 전송 예시

아래는 **실측이 아닌 가정 계산**이다. 이미지당 표시본400KiB+미리보기50KiB, 삭제 유예/복원 사본 추가20%, 조직 내 여유50MB를 더했다. 중복 제거는 아직 미구현이므로 기본 계산에 절감 효과를 넣지 않았다. 월0원 목표의 계획상 중단선은 공개 포함량80%이며 실제 외부 사용량/진행 중 예약을 빼면 더 낮아진다.

| 이미지 수 | 보관 예산(GB, 여유 포함) | 전체6회 상당 다운로드(GB) | 판단 |
|---|---:|---:|---|
|500|0.326|1.382|Supabase 초기 소규모 검증 후보 |
|2,000|1.156|5.530|Supabase 저장/전송 공개 포함량을 초과하는 가정 |
|10,000|5.580|27.648|R2 무료 저장 범위의 후보지만 다른 비용·지역 결정이 필요 |

‘6회’는 예를 들어2기기 초기 복원+전체 보기4회에 해당하는 전송 스트레스 가정이다. 매월 반드시 이만큼 전송된다는 예측이 아니며 로컬 캐시·변경분 전송으로 줄여야 한다. Supabase Egress는 이 파일 bytes 외에도 Auth/RPC/동기화 응답을 더해야 한다.

위 가정의80% 저장 중단선은 Supabase 약1,356개, R2 약14,377개다. 실제 지원 개수나 업로드 제한으로 확정하지 않는다. 중복30%를 제거할 수 있다고 가정해도2,000개는0.824GB로 Supabase의0.8GB 계획선을 넘는다. 무료 용량을 늘려 보이기 위해 아직 없는 dedup를 기본값으로 가정하지 않는다. 계산값·가정은 [예산 시나리오 JSON](evidence/blob-budget-scenarios.json)에 기록했다.

제품용1920/2048px·WebP 품질/보기 가독성 기준은46문서의 후보 그대로다. **현재 자산 PoC는64KiB 한도**이므로 위400KiB 제품 예시를 현재 서버가 저장할 수 있다고 해석하지 않는다. 한도 확대와 실제 화질 비교는 별도 구현/검증이다.

## 공급자와 무관하게 유지할 저장 계약

```text
V2 클라이언트 → gateway(검증한 사용자/세션/공간/기기)
                    ├→ DB: 권한, 예약량, 논리 자산/공유 실물 참조
                    └→ private Blob adapter: bytes/hash/검증/정리
V1 로컬 앱 → 기존 DB18/이미지 처리 그대로
```

storeId는 서버에서 등록한 공급자/개발·운영 대상에만 매핑한다. 클라이언트가 임의 endpoint/objectKey를 지정해 자격증명을 보내게 하지 않는다. bytes는 DB/base64에 넣지 않고 private Blob에 둔다. workspace 내 hash로 실물 공유하되 논리 자산 ID·참조는 별도이며 다른 계정 간 dedup는 허용하지 않는다. 기존 V1 DB18과 원본 이미지는 자동 변환/삭제하지 않는다.

세션 회수 직후 차단 요구 때문에 첫 검증은 gateway 중계/재검사 모델을 유지한다. 장기 서명 URL을 문서에 저장하거나 공개 URL로 우회하지 않는다. 직접 서명 전송을 나중에 채택하면 URL 만료 전 회수 지연·미확정 업로드·quota·취소 경쟁을 별도 설계해야 한다.

## 다음 실제 파일 검증 범위

공급자/대상/무료 잔여량을 확인한 다음, DEV 전용 private 테스트 저장소와 가상 표본만 사용한다. 운영 예정 프로젝트와 기존 사용자 bucket은 수정하지 않는다. Supabase안을 선택해도 실제 생성 전에 DEV 조직 Free/Storage/Egress 확인이 필요하다.

| 순서 | 검증 | 완료 근거 |
|---|---|---|
|1|현재 readiness·고정DEV ref·Free/Usage·동명 충돌 점검|기존 저장소 재사용/삭제 금지, 비용/대상 증거 |
|2|private 전용 bucket·MIME/64KiB 제한·클라이언트 직접 접근 거절|공개 URL/무인증/다른 계정 실패, RLS/ACL 확인 |
|3|가상 PNG/WebP/UTF-8 파일 각1개, 각64KiB 이하·합계192KiB 이하 예약/전송|실제 hash·bytes 일치, readback/duplicate retry 결과 |
|4|권한 없는 계정·회수 세션·quota/동시 예약·취소/응답 유실|예약/실물/참조/lease 정합성, 메타데이터만 성공한 것으로 대체하지 않음 |
|5|삭제/복구 후 정리|실물 부재＋metadata잔여0. 생성한 테스트 계정/저장소만 제거 |

위 표의 표본192KiB는 단발성 전송량 상한 약속이 아니다. 재조회/검증/실패 재시도 횟수와 일별 API 예산도 함께 제한한다. 사용자 자료·대용량 파일·내구성 시험/부하 시험은 포함하지 않는다. 실제 영속 DB-only install.sql을 다시 실행하지 않는다.

R2를 선택하면 추가로 Cloudflare 구독 조건 검토, DEV/PROD bucket 분리와 최소 권한, exact endpoint HTTP 시크릿 또는 Workers binding, Worker runtime CPU/JWT/메모리/재시도 시험이 필요하다. 아직 존재하지 않는 계정/endpoint/Secret을 미리 설정하라고 요청하지 않는다.

이번 단계의 완료는 **공식 조건 재검증·추천안·계산·시험 범위 정리**다. 공급자 선택과 실제 파일 종단간 검증은 완료로 표시하지 않는다.

## 사용자 확정 후 상태

사용자가 Supabase를 우선 선택했다. [54문서](54-supabase-storage-decision.md)의 결정이 이 문서의 공급자 미선정/지역 답변 대기보다 우선한다. Supabase private Storage로 실제 시험을 준비하며 Pro 결제는 하지 않는다. U07 개발 실제 플랜/Usage와 파일 전송 검증은 남아 있다.
