-- 0002: 중요 표시 + 매주 반복(docs/important-repeat-spec.md 4-1). 전진 전용 — 이 파일은 고치지 않는다.

CREATE TABLE recurrence (
  id             TEXT PRIMARY KEY,
  category_id    TEXT NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  weekday        INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_week     TEXT NOT NULL CHECK (start_week GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'),
  end_week       TEXT CHECK (end_week IS NULL OR end_week GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'),
  flag_on_create INTEGER NOT NULL DEFAULT 0 CHECK (flag_on_create IN (0, 1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE recurrence_line (
  recurrence_id TEXT NOT NULL REFERENCES recurrence(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL CHECK (seq >= 1),
  depth         INTEGER NOT NULL CHECK (depth IN (0, 1)),
  text          TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  PRIMARY KEY (recurrence_id, seq)
);

CREATE TABLE recurrence_week (
  recurrence_id TEXT NOT NULL REFERENCES recurrence(id) ON DELETE CASCADE,
  week_id       TEXT NOT NULL CHECK (week_id GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'),
  created_at    TEXT NOT NULL,
  PRIMARY KEY (recurrence_id, week_id)
);

ALTER TABLE entry_item ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0 CHECK (flagged IN (0, 1));

ALTER TABLE entry_item ADD COLUMN flag_done_at TEXT;

ALTER TABLE entry_item ADD COLUMN recurrence_id TEXT REFERENCES recurrence(id) ON DELETE SET NULL;

CREATE INDEX ix_item_flagged ON entry_item(date) WHERE flagged = 1;

CREATE INDEX ix_item_flag_done ON entry_item(flag_done_at) WHERE flag_done_at IS NOT NULL;

CREATE INDEX ix_item_recurrence ON entry_item(recurrence_id) WHERE recurrence_id IS NOT NULL;
