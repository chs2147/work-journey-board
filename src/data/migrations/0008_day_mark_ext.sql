-- 0008: 휴일 설정 — 공휴일·기타 휴가(docs/features-1102-spec.md F2). 전진 전용 — 이 파일은 고치지 않는다.
-- day_mark의 kind에 holiday(공휴일·회사 휴일 직접 지정)·other(기타 휴가: 공가·야유회 등)를 더하고, 이름·사유(label)를 둔다.
-- SQLite는 CHECK 조건을 바꿀 수 없어 새 표를 만들어 옮긴다(행·값 그대로).

CREATE TABLE day_mark_new (
  date       TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind       TEXT NOT NULL CHECK (kind IN ('leave', 'half_am', 'half_pm', 'holiday', 'other')),
  label      TEXT CHECK (label IS NULL OR length(label) <= 40),
  updated_at TEXT NOT NULL
);

INSERT INTO day_mark_new (date, kind, label, updated_at) SELECT date, kind, NULL, updated_at FROM day_mark;

DROP TABLE day_mark;

ALTER TABLE day_mark_new RENAME TO day_mark;
