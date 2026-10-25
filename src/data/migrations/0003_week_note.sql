-- 주간 메모(docs/weekly-note-spec.md 5절): 요일 메모(day_memo) → 주 1개 자유 메모.
-- day_memo 표는 지우지 않는다. 메모 문서가 아직 없는 주는 앱이 그 주의 요일 메모를 상자 1개로 보여 주고,
-- 처음 저장할 때 week_note로 옮긴다(주차 계산은 domain/week.ts만 — SQL로 주차를 세지 않는다, CLAUDE.md 4-4).

CREATE TABLE week_note (
  week_id    TEXT PRIMARY KEY CHECK (week_id GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'),
  doc        TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 메모 이미지(N2에서 사용). 실앱·브라우저 모드에서 같은 방식으로 오가도록 base64 TEXT로 둔다.
CREATE TABLE note_asset (
  id         TEXT PRIMARY KEY,
  week_id    TEXT NOT NULL,
  mime       TEXT NOT NULL CHECK (mime IN ('image/webp', 'image/png', 'image/jpeg', 'image/gif')),
  data       TEXT NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  bytes      INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX note_asset_week ON note_asset(week_id);
