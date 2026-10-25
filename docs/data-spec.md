# Work Journey Board — 데이터 상세 스펙 (D2)

> **이관 안내**: 이 문서는 2026-10-22 설계 저장소 [my-discussions](https://github.com/chs2147/my-discussions)의 `topics/10 work-journal-board/`에서 옮겨왔다. **이후 정본은 이 저장소의 `docs/`** 이며 my-discussions 쪽은 더 이상 갱신하지 않는다.

> 작성: 2026-10-22 · 상위 문서: [README.md](overview.md) · 진행 계획: [project-plan.md](project-plan.md) D2
> 전제: ◆G1 = **GO(Tauri + SQLite 파일)** 가정. 대안 전환 시 매핑은 **8절**.
> 이 문서만 보고 구현자가 테이블·규칙을 그대로 만들 수 있는 수준을 목표로 한다.

---

## 0. 결정 요약

| # | 항목 | 확정 |
|---|---|---|
| 1 | 주차 규칙 | **ISO 8601** (월요일 시작, 1월 4일이 든 주 = 1주차). 주차 ID `YYYY-Www`(ISO 연도 기준). 2026년은 **53주** |
| 2 | 항목 저장 형식 | **항목 1개 = 1행** (`entry_item`, 순서 `seq` + 깊이 `depth` 0/1) |
| 3 | 테이블 | `category` · `category_period` · `entry_item` · `day_memo` · `weekly_summary` · `app_meta` (6개) |
| 4 | 카테고리 활성 | **활성 구간(period) 테이블**로 관리. 주 W에 보임 = 구간이 W와 겹침 **또는** W에 그 업무 기록이 있음 |
| 5 | 3주 무기록 | "무기록 주" = 그 업무 항목 0개인 주. **아무것도 안 쓴 주(휴가 주)는 셈에서 제외**, 생성 직후 N주 유예, "유지" 시 N주 뒤 재판정 |
| 6 | 삭제 정책 | 카테고리 = 아카이브만(**기록 0건이면 실삭제 허용**). 항목 = 실삭제 + 세션 내 되돌리기(Ctrl+Z) + 5초 토스트 |
| 7 | 백업·이전 | `VACUUM INTO`로 일 1회 롤링(**최근 14일 + 월 1개×12**) + 수동 백업(자동 삭제 안 함) + 마이그레이션 직전 자동 백업 |
| 8 | G1 대안 시 | 같은 SQL 스키마를 **SQLite WASM(sql.js)** 으로 브라우저에서 실행, 파일은 File System Access로 같은 `.db` 형식 저장 |

---

## 1. 주차 규칙

### 1-1. ISO 8601 채택
- 주 = **월요일 ~ 일요일**. 1주차 = 그 해 1월 4일이 포함된 주.
- 주차 ID = **ISO 연도** 기준 `YYYY-Www` (예 `2026-W43`). 달력 연도와 다를 수 있다.
  - `2025-12-29(월)` ~ `2026-01-04(일)` = **2026-W01**
  - `2026-12-28(월)` ~ `2027-01-03(일)` = **2026-W53** ← 2026년은 1월 1일이 목요일이라 53주
- 연간 보기(미니맵)의 "2026년" = ISO 연도 2026의 W01~W53. 달력상 2025-12-29~31도 여기 포함된다.

### 1-2. 보드 제목 표기
| 경우 | 표기 |
|---|---|
| 같은 해 안 | `2026-W43 (10/19~10/25)` |
| 주가 해를 넘김 | `2026-W53 (2026/12/28~2027/01/03)` |
| 주가 달을 넘김(같은 해) | `2026-W44 (10/26~11/01)` — 별도 처리 없음 |

### 1-3. 구현 원칙
- 날짜는 전부 **로컬 날짜 문자열 `YYYY-MM-DD`** 로 저장(시간대 없음). "오늘" = PC 로컬 시각 기준.
- 타임스탬프(감사용 `created_at`·`updated_at`)만 UTC ISO 문자열 `YYYY-MM-DDTHH:mm:ss.sssZ`.
- **주차 계산은 앱 코드의 단일 모듈**(`src/domain/week.ts`, date-fns `getISOWeek`/`getISOWeekYear`/`startOfISOWeek` 기반)에서만. SQL에서 `strftime('%W')`(ISO 아님)를 쓰지 않는다. 주 단위 조회는 **날짜 범위**(`date BETWEEN 월 AND 일`)로.
- 필수 경계 테스트: `2025-12-29`, `2026-01-01`, `2026-01-04`, `2026-01-05`, `2026-12-27`, `2026-12-28`, `2027-01-03`, `2027-01-04`, 윤년 `2028-02-29`, 53주 연도 2026·2032.

---

## 2. 개조식 항목 저장 형식 — 항목 1개 = 1행
- 하루 × 업무 칸(셀) 안의 개조식 줄 하나가 `entry_item` 1행.
- 이유: 엑셀 원장(항목 1행), 경과 타임라인(항목 단위 나열), 히트맵(항목 수 집계)이 전부 행 단위라 변환이 없다.
- **깊이 2단**: `depth 0`(본 항목) / `depth 1`(세부). 셀의 첫 항목은 반드시 depth 0(앱이 보장).
- **순서**: `seq`는 셀 안에서 1부터 연속 정수. 순서 변경·삽입 시 그 셀 전체를 트랜잭션 안에서 다시 번호 매김(셀당 항목이 수십 개를 넘지 않으므로 충분).
- 빈 줄은 저장하지 않는다(편집을 벗어날 때 빈 항목 삭제).
- 항목 안 줄바꿈(Shift+Enter)은 `text` 안의 `\n`으로 허용.

---

## 3. 테이블 정의

### 3-1. 연결 설정 (앱 시작 시 매번)
```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = DELETE;   -- WAL 미사용: 데이터 = 파일 1개 원칙(-wal/-shm 동반 파일 없음)
PRAGMA synchronous = FULL;      -- 쓰기량이 극히 적어 성능 영향 없음, 정전 안전 우선
PRAGMA busy_timeout = 3000;
```
- WAL을 쓰지 않는 이유: 사용자가 `.db`만 복사해 옮기면 WAL에 남은 최근 기록이 유실될 수 있음 → "백업=파일 복사"가 깨진다.
- 앱은 **단일 인스턴스**로만 실행(Tauri single-instance 플러그인) → 동시 쓰기 주체 1개.

### 3-2. 스키마 SQL (schema_version = 1)
```sql
-- 업무 카테고리: 이름이 바뀌어도 이어지는 실체(고유 ID)
CREATE TABLE category (
  id                  TEXT PRIMARY KEY,               -- UUIDv7 (앱에서 생성)
  name                TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  color               TEXT NOT NULL CHECK (color IN ('c1','c2','c3','c4','c5','c6','c7','c8')),
  sort_order          INTEGER NOT NULL,               -- 보드 행 순서(작을수록 위)
  nudge_snoozed_until TEXT,                           -- 종료 제안 '유지' 시 재판정 시작 주의 월요일(YYYY-MM-DD)
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- 활성 구간: 아카이브·재활성 이력을 구간으로 보존(기간 막대 차트의 원천)
CREATE TABLE category_period (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  start_date  TEXT NOT NULL,                          -- 이 구간 시작(YYYY-MM-DD, 항상 월요일)
  end_date    TEXT,                                   -- 종료일(아카이브한 날). NULL = 진행 중
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX ix_period_category ON category_period(category_id, start_date);
CREATE UNIQUE INDEX ux_period_open ON category_period(category_id) WHERE end_date IS NULL;  -- 열린 구간은 업무당 1개

-- 개조식 항목: 1줄 = 1행
CREATE TABLE entry_item (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  category_id TEXT NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
  seq         INTEGER NOT NULL CHECK (seq >= 1),
  depth       INTEGER NOT NULL DEFAULT 0 CHECK (depth IN (0, 1)),
  text        TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX ix_item_cell     ON entry_item(date, category_id, seq);   -- 보드 셀 조회
CREATE INDEX ix_item_category ON entry_item(category_id, date);        -- 타임라인·히트맵·무기록 판정

-- 일일 메모: 카테고리에 안 맞는 내용(하루 1개)
CREATE TABLE day_memo (
  date       TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  text       TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
  updated_at TEXT NOT NULL
);

-- 주간 요약: 자동 집계본은 저장하지 않고 항상 계산(5-2절). AI본·수정본만 저장
CREATE TABLE weekly_summary (
  week_id           TEXT PRIMARY KEY CHECK (week_id GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'),
  ai_text           TEXT,
  ai_basis_hash     TEXT,          -- AI본 만들 때 사용한 자동 집계본의 해시(이후 기록 변경 감지)
  ai_saved_at       TEXT,
  edited_text       TEXT,
  edited_basis_hash TEXT,
  edited_at         TEXT
);

-- 메타·설정: 키-값
CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 초기 행: ('schema_version','1'), ('created_at', <ts>), ('settings', <JSON 3-4절>)
```

### 3-3. 계획 초안(project-plan D2-3) 대비 변경점과 이유
| 초안 | 확정 | 이유 |
|---|---|---|
| `category.created_at / archived_at` | **`category_period` 테이블 분리** | 종료 후 재활성화하면 단일 `archived_at`으로는 공백 기간이 "활성"으로 보임 → 과거 주 보드에 빈 행이 생기고 기간 막대에 공백이 안 나타남 |
| `weekly_summary.auto_text` | **저장 안 함(항상 계산)** | 기록을 고치면 자동 집계는 자동으로 따라가야 함. 저장하면 낡은 사본이 생김 |
| — | `ai_basis_hash`·`edited_basis_hash` 추가 | AI본·수정본 작성 후 원 기록이 바뀌면 "기록이 변경되었습니다" 안내 |
| `app_meta(schema_version, settings JSON)` | 키-값 테이블 | 컬럼 추가 없이 메타 항목을 늘릴 수 있음 |
| id 미정 | **UUIDv7 TEXT** | 앱에서 ID를 먼저 만들어 즉시 화면 반영(낙관적 갱신), 저장소 구현(SQLite·sql.js)과 무관하게 동일 |
| `color` 자유값 | 팔레트 키 `c1`~`c8` | 색약 대비가 검증된 8색 고정 팔레트([viz-spec.md](viz-spec.md) 6절). 실제 색값은 화면 토큰에서 키→색 변환(라이트/다크 각각) |

### 3-4. 설정 JSON (`app_meta.settings`)
```json
{
  "nudgeWeeks": 3,                 // 무기록 종료 제안 기준 주 수, 0 = 끔, 범위 2~8
  "backup": { "dailyKeep": 14, "monthlyKeep": 12 },
  "summary": { "includeMemo": true },
  "ai": {
    "mode": "clipboard",           // "off" | "clipboard" | "api"(v1에서는 선택 불가, 자리만)
    "promptTemplate": null,        // null = 기본 템플릿(output-spec.md 4절)
    "api": { "endpoint": null, "model": null }   // API 키는 DB에 저장하지 않음(윈도우 자격 증명 관리자, M4에서 확정)
  },
  "ui": { "summaryPanelOpen": false, "lastExportDir": null,
          "noteDockAuto": true, "noteDockHeight": 280, "noteDockCollapsed": false }
          // 메모 도크: 자동 높이(기본) / 끌어서 정한 높이(최소 120)·접힘(weekly-note-spec 3절·14절)
}
```
- **저장 폴더 경로는 DB에 둘 수 없다**(DB를 찾기 위한 정보이므로). → `%LOCALAPPDATA%\WorkJourneyBoard\config.json`에 `{ "dataDir": "...", "window": {...} }`만 저장. Roaming이 아닌 Local을 쓰는 이유: 회사 PC 로밍 프로필로 경로가 다른 PC에 퍼지지 않게.

### 3-5. 데이터 규모 추정
- 하루 5업무 × 5항목 × 250일 ≈ **연 6,250행**, 항목 평균 60자 → DB 파일 연 1~2 MB. 10년 써도 20 MB 이하.
- → 모든 조회는 인덱스 + 날짜 범위로 충분. 페이지네이션·캐시 계층 불필요.

---

### 3-x. 스키마 v2 (2026-10-24, `0002_important_repeat.sql`)
- `entry_item`에 `flagged`(중요 표시) · `flag_done_at`(처리 완료 시각) · `recurrence_id`(매주 반복 연결)를 더하고, 반복 규칙 표 `recurrence` · `recurrence_line` · `recurrence_week`를 만든다. 정의·규칙은 [important-repeat-spec.md](important-repeat-spec.md) 4절이 정본이다.
- 올릴 때 7-5절 규칙대로 직전 백업(`_pre-migration-v2`) 후 한 트랜잭션으로 적용한다.

### 3-y. 스키마 v3 (2026-10-25, `0003_week_note.sql`)
- 주간 메모 표 `week_note(week_id PK, doc JSON, updated_at)`와 메모 이미지 표 `note_asset`(N2부터 사용)을 만든다. 정의·문서 JSON·용량은 [weekly-note-spec.md](weekly-note-spec.md) 5절이 정본이다.
- `day_memo`(요일 메모)는 **지우지 않고 읽기만** 한다: 그 주에 `week_note` 행이 없으면 요일 메모를 상자 1개의 글머리 목록으로 바꿔 보여 주고, 처음 저장할 때 `week_note`로 옮겨진다(비워도 행을 남겨 요일 메모가 다시 나오지 않게). 앱에는 `day_memo`에 쓰는 경로가 없다.
- `note_asset`(v0.2.2 N2부터 사용): 그림 = base64 TEXT, `bytes` = 저장한 그림 크기. 넣는 순간 행을 쓰고, 문서가 더는 가리키지 않는 행은 그 주를 떠날 때(주 이동·앱 종료) 지운다 — DB 안의 행 정리이며 사용자 폴더 파일 삭제가 아니다(4-3 삭제 가드와 무관).
- 직전 백업은 `_pre-migration-v3`.

## 4. 카테고리 활성 계산

### 4-1. 주 W에 보일 카테고리
주 W의 월요일 = `mon`, 일요일 = `sun`:
```sql
SELECT c.*
FROM category c
WHERE EXISTS (SELECT 1 FROM category_period p
              WHERE p.category_id = c.id
                AND p.start_date <= :sun
                AND (p.end_date IS NULL OR p.end_date >= :mon))
   OR EXISTS (SELECT 1 FROM entry_item e
              WHERE e.category_id = c.id AND e.date BETWEEN :mon AND :sun)
ORDER BY c.sort_order;
```
- 경계 확정: **구간이 W와 하루라도 겹치면 보임**(양 끝 포함). 아카이브한 그 주에는 여전히 보이고 다음 주부터 사라진다.
- 두 번째 조건(그 주에 기록이 있으면 보임)은 **데이터가 화면에서 숨는 일을 구조적으로 막는 안전장치**.
- 이월(R7)에 복사 연산 없음 — 열린 구간(`end_date IS NULL`)이 미래 주와 계속 겹치므로 자동으로 보인다.

### 4-2. 그 주에서의 표시 상태
| 상태 | 조건 | 보드 표시 |
|---|---|---|
| 진행 중 | 열린 구간이 있음 | 일반 |
| 이 주 중 종료 | W와 겹치는 구간의 `end_date`가 W 안 | 행 흐리게 + "종료됨" 태그(입력 가능) |
| 기록만 남음 | 구간과 겹치지 않으나 W에 기록 있음 | 행 흐리게 + "종료됨" 태그 |

### 4-3. 조작별 데이터 변화
| 조작 | 처리 |
|---|---|
| 업무 추가 | `category` 1행 + 구간 1행(`start_date` = **보고 있는 주의 월요일**, `end_date` NULL). 과거 주를 보다가 추가하면 그 주부터 보인다(지난 기록 보충용) |
| 이름·색·순서 변경 | `category`만 갱신. 과거 주에도 새 이름으로 보인다(이력 연속) |
| 종료(아카이브) | 열린 구간의 `end_date` = 오늘 |
| 재활성화 | 마지막 구간의 `end_date` ≥ 이번 주 월요일이면 그 구간을 다시 연다(`end_date` NULL). 아니면 새 구간(`start_date` = 이번 주 월요일) |
| 미래 주로 이동해 기록 | 허용(일정 메모 등). 특별 처리 없음 |

---

## 5. 3주 무기록 종료 제안

### 5-1. 정의
- **무기록 주**: 그 주(월~일)에 해당 업무의 `entry_item`이 0개.
- **판정 대상 주**: 이번 주를 뺀 지난 주들 중 **"뭐라도 기록한 주"** 만 센다. 모든 업무 항목 0개 + 주간 메모에 글 없음(옮기기 전 요일 메모 포함)인 주(휴가·출장 등)는 셈에서 빠진다. → 2주 휴가 다녀와서 모든 업무에 종료 제안이 뜨는 일을 막는다.
- 거슬러 보는 범위는 최대 12주.

### 5-2. 판정식 (N = `settings.nudgeWeeks`, 기본 3)
이번 주 C 기준으로, 업무 X에 제안을 띄우는 조건 — **모두 참**일 때:
1. X에 열린 구간이 있다(진행 중).
2. C-1부터 거슬러 올라가며 "뭐라도 기록한 주"를 N개 모을 수 있다(최대 12주 안에서). 그 N개 주의 가장 이른 주 = `W_first`.
3. **유예**: X의 열린 구간 `start_date` ≤ `W_first`의 월요일 (만든 지 N주가 안 된 업무는 제안 안 함).
4. 그 N개 주 모두에서 X의 항목이 0개.
5. 이번 주 C에도 X의 항목이 아직 0개.
6. `nudge_snoozed_until`이 NULL이거나, C의 월요일 > `nudge_snoozed_until`.

### 5-3. 사용자 응답
| 응답 | 처리 |
|---|---|
| 종료 | 4-3절 "종료" 처리 |
| 유지 | `nudge_snoozed_until` = C의 월요일 + N주. 그 뒤 다시 2~5를 만족하면 재제안(=유지 후 최소 N주는 조용) |
| 무응답 | 계속 표시(행 머리의 작은 표시라 방해되지 않음, [overview.md 10-4절](overview.md)) |

- 판정은 **이번 주를 볼 때만** 표시(과거 주 보드에는 안 뜸). `nudgeWeeks = 0`이면 기능 끔.

---

## 6. 삭제 정책

| 대상 | 정책 |
|---|---|
| 카테고리 | **아카이브만**. 단, **기록이 한 건도 없는 업무는 실삭제 허용**("실수로 만든 업무 삭제") — 확인 대화상자 후 `category` + `category_period` 삭제 |
| 항목 | **실삭제**. 되돌리기: ① 세션 내 실행 취소 스택(Ctrl+Z / Ctrl+Y, 최근 50 조작, 앱 종료 시 소멸) ② 삭제 직후 5초 토스트 "항목 삭제됨 [되돌리기]" ③ 그 이상은 백업에서 복원 |
| 주간 메모 | 상자 삭제는 토스트 [되돌리기] + 메모 실행 취소(`Ctrl+Z`, 보드 실행 취소와 별도 — weekly-note-spec 4-5). 메모를 다 비워도 `week_note` 행은 남긴다(빈 문서) |
| 주간 요약 AI본·수정본 | 개별 "삭제" 버튼, 확인 후 해당 컬럼 NULL |

- 실행 취소 스택 대상 조작: 항목 추가·수정·삭제·순서·깊이 변경, 업무 이름·색·순서 변경(주간 메모는 따로 — 위 표). **종료·재활성화는 대상 아님**(별도 버튼으로 언제든 되돌릴 수 있으므로).

---

## 7. 백업·이전·마이그레이션

### 7-1. 파일 배치
```
<사용자가 고른 저장 폴더>/
├─ work-journey.db                         ← 본 데이터(유일한 원본)
├─ backups/
│  ├─ work-journey_2026-10-22.db           ← 일일 자동(롤링 14개)
│  ├─ work-journey_2026-10_monthly.db      ← 월간 자동(롤링 12개)
│  ├─ work-journey_2026-10-22_1430_manual.db       ← 수동 "지금 백업"(자동 삭제 안 함)
│  └─ work-journey_2026-10-22_1431_pre-migration-v2.db  ← 마이그레이션 직전(자동 삭제 안 함)
└─ exports/                                ← 엑셀 내보내기 기본 위치
```

### 7-2. 백업 규칙
- 방법: **`VACUUM INTO '<경로>'`** — 앱이 DB를 연 상태에서도 일관된 사본을 만든다(단순 파일 복사는 쓰기 도중이면 깨질 수 있음).
- **파일명 시각 = 로컬 시각**(PC 시간대) — UTC(`toISOString`)를 쓰지 않는다. I-M0에서 UTC로 찍힌 파일명이 9시간 어긋난 것을 확인(overview 13-3).
- **일일**: 그날 첫 실행 시 1회 + 앱 종료 시 같은 날짜 파일을 덮어씀. → 그날 마지막 상태가 남는다.
- **월간**: 그 달의 첫 일일 백업 때 `_monthly` 사본도 만든다(그 달에 이미 있으면 건너뜀).
- **롤링 삭제**: 일일은 최신 14개, 월간은 최신 12개만 남긴다. **삭제 대상은 정확히 위 두 파일명 패턴에 맞는 파일만** — 수동·마이그레이션 백업, 사용자가 넣은 다른 파일은 절대 지우지 않는다.
- **쓰기 방식(S2 확정)**: `VACUUM INTO`로 임시 사본(`<최종이름>.tmp`)을 만들고 → 검증(`quick_check`) → 최종 이름으로 바꾼다(같은 날 일일 사본은 이 방식으로 덮어씀). 앱이 지울 수 있는 파일은 **일일·월간 패턴 + 앱이 만든 임시 사본(`work-journey_*.db.tmp`)** 뿐이며, 삭제는 `src/data/backup.ts`의 가드 함수 한 곳에서만 한다.
- 백업 후 사본에 `PRAGMA quick_check` → 실패하면 사본 삭제 + 경고 표시(기존 백업은 건드리지 않음).
- 설정 화면: 마지막 백업 시각, [지금 백업], [백업 폴더 열기], [백업에서 복원](M5).

### 7-3. 무결성·복원
- 앱 시작 시 `PRAGMA quick_check`. 실패 → "데이터 파일에 문제가 있습니다" 화면 + 최근 백업 목록에서 복원 제안.
- 복원 절차(M5): ① 현재 파일을 `work-journey_<시각>_before-restore.db`로 보존 ② 선택한 백업을 `work-journey.db`로 복사 ③ 재시작. 현재 파일을 지우지 않는다.

### 7-4. 저장 위치 변경·PC 교체
- **같은 PC에서 위치 변경**: 설정 > 저장 위치(overview 10-10). 새 위치 파일은 `VACUUM INTO`로 만들고(열린 DB도 안전), 대상에 `work-journey.db`가 있으면 덮어쓰지 않고 "그 일지로 전환"만 허용. 원본은 지우지 않는다.
- **PC 교체**: 새 PC에 앱 설치 → 첫 실행에서 "기존 일지 열기"로 옮겨온 폴더(또는 `.db` 파일)를 선택. 그 외 절차 없음.

### 7-5. 스키마 마이그레이션 원칙
- `app_meta.schema_version` 정수. 마이그레이션은 `migrations/0002_xxx.sql`처럼 **번호 순 전진 전용**(되돌림 스크립트 없음, 대신 직전 백업).
- 실행 순서: 버전 비교 → 올릴 게 있으면 **`_pre-migration-v{n}` 백업** → 단일 트랜잭션으로 적용 + `schema_version` 갱신 → `quick_check`. 실패 시 롤백 + 백업 위치 안내.
- **앱보다 높은 버전의 DB**(구버전 앱으로 연 경우)는 열지 않고 "앱을 업데이트하세요" 안내(쓰기 금지).
- 구조 변경(ALTER·컬럼 삭제)이 들어가는 마이그레이션은 공통 규칙 7-3절의 고위험 취급 — 실제 4주 이상 분량의 샘플 DB로 왕복 테스트 후 배포.

---

## 8. 저장소 계층과 G1 대안 전환 매핑

### 8-1. 저장소 인터페이스 (구현의 뼈대)
앱 로직은 SQL 드라이버 인터페이스 하나에만 의존한다. 구현 저장소의 기본 골격([CLAUDE.md](../CLAUDE.md) 참조):
```ts
interface SqlDriver {
  execute(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<number>; // 전부 성공 또는 전부 취소
  close(): Promise<void>;
}
// 백업은 driver.execute("VACUUM INTO ...")로 한다(src/data/backup.ts).

interface JournalRepository {          // SqlDriver 위의 단일 구현
  getWeek(weekId: string): Promise<WeekView>;  // 보일 카테고리 + 7일 항목 + 주간 메모 + 요약
  saveCell(date: string, categoryId: string, items: ItemDraft[]): Promise<void>; // 셀 단위 통째 저장(트랜잭션)
  getWeekNote(weekId: string): Promise<{ doc: NoteDoc; legacy: boolean }>; // legacy = 요일 메모를 옮겨 보여 주는 중
  saveWeekNote(weekId: string, doc: NoteDoc): Promise<void>;              // 문서 통째(허용 노드만 남겨 저장)
  addNoteAsset(weekId, image): Promise<string>; getNoteAssets(weekId); pruneNoteAssets(weekId, keepIds); noteAssetStats();
  createCategory(...); updateCategory(...); archiveCategory(id); reactivateCategory(id); deleteEmptyCategory(id);
  getNudges(currentWeekId: string): Promise<string[]>;          // 5절
  getRange(fromWeek: string, toWeek: string): Promise<RangeData>; // 엑셀·시각화 공용
  saveSummary(weekId: string, patch: SummaryPatch): Promise<void>;
}
```
- 셀 저장은 "그 셀의 항목 목록 전체를 받아 트랜잭션으로 교체"(삭제 후 재삽입이 아니라 id 기준 upsert + 빠진 id 삭제). 순서·깊이 변경도 이 한 경로로 처리 → 버그 지점 최소화.
- **트랜잭션은 `batch`로만(S2 실측으로 확정)**: tauri-plugin-sql은 내부가 연결 풀이라 JS에서 `BEGIN`/`COMMIT`을 따로 보내면 다른 연결로 갈 수 있고, 중간에 실패하면 트랜잭션이 열린 연결이 풀에 남아 **이후 모든 쓰기가 막힌다**. 그래서 실앱의 `batch`는 Rust 명령 `db_batch`(플러그인이 연 같은 풀에서 sqlx `Transaction` — 커밋 전 실패 시 자동 롤백)로 구현한다. sql.js는 단일 연결이라 BEGIN/COMMIT/ROLLBACK으로 같은 의미를 낸다.
- 자리표시자는 위치 기반 `?`만 쓴다(sql.js·sqlx 공통).

### 8-2. 드라이버 구현 3종 — 같은 SQL, 같은 스키마
| 드라이버 | 쓰는 곳 | 비고 |
|---|---|---|
| `TauriSqlDriver` | 실앱(윈도우) | tauri-plugin-sql(SQLite). 사용자 선택 폴더 절대 경로로 열기(M0 확인). `batch`는 Rust `db_batch` 명령 |
| `SqlJsDriver` (메모리) | 개발·테스트(클라우드 리눅스·브라우저) | SQLite WASM. **실앱과 동일한 스키마·마이그레이션 SQL이 그대로 돈다** → 저장 로직 테스트가 실제 SQL을 검증 |
| `SqlJsFileDriver` | **G1 대안 전환 시**(브라우저 전용) | 아래 8-3 |

### 8-3. G1 "대안 전환" 시 매핑 (Chrome 전용)
- 같은 `SqlJsDriver`에 **File System Access 저장**을 붙인다:
  - 첫 실행: `showDirectoryPicker()`로 폴더 선택 → `work-journey.db` 읽어 sql.js에 적재(없으면 새로 생성).
  - 저장: 변경 후 1초 디바운스로 DB 전체를 `export()` → `createWritable()`로 덮어쓰기(연 2 MB 수준이라 전체 쓰기로 충분).
  - 백업: 같은 폴더의 `backups/`에 같은 파일명 규칙으로 쓴다.
  - **IndexedDB는 폴더 핸들(`FileSystemDirectoryHandle`) 보관 용도만**. 데이터 자체를 IndexedDB에 두지 않는다(캐시 정리 시 유실 위험, overview.md 3-3절).
- 효과: 논리 모델뿐 아니라 **파일 형식까지 동일** → 나중에 Tauri로 옮겨도 같은 `.db`를 그대로 연다.
- 제약: 탭을 새로 열 때마다 폴더 접근 권한 재확인 프롬프트가 뜰 수 있음(Chrome의 "이 사이트에서 항상 허용" 옵션으로 완화). 단일 인스턴스 보장이 없으므로 `BroadcastChannel`로 두 번째 탭은 읽기 전용 처리.

---

## 9. 구현 체크리스트 (I-M1 테스트 항목으로 그대로 사용)
- [ ] ISO 주차 경계 10건(1-3절) 단위 테스트
- [ ] 주 W 보이는 카테고리: 구간 겹침 양 끝(월·일 당일), 이 주 중 종료, 기록만 남은 경우, 재활성 공백 구간
- [ ] 무기록 판정: 기본 3주, 휴가 주 제외, 생성 직후 유예, 유지 후 N주 침묵, 이번 주에 기록 시 미표시, `nudgeWeeks=0`
- [ ] 셀 저장: 추가·수정·삭제·순서 변경·깊이 변경이 한 트랜잭션, 첫 항목 depth 0 보장, 빈 항목 미저장
- [ ] 백업: VACUUM INTO 사본 무결성, 롤링 삭제가 패턴 외 파일을 건드리지 않음, 월간 1개/월
- [ ] 마이그레이션: 직전 백업 생성, 실패 시 롤백, 상위 버전 DB 거부
