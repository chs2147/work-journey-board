-- 0013: 업무 항목 마감일(docs/improve-1104v10-spec.md 4절). 전진 전용 — 이 파일은 고치지 않는다.
-- 그날까지 끝내야 하는 날짜(YYYY-MM-DD) — 기록한 날과 달라도 된다. 없으면 NULL.
ALTER TABLE entry_item ADD COLUMN due_date TEXT
  CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]');
CREATE INDEX ix_entry_item_due ON entry_item (due_date) WHERE due_date IS NOT NULL;
