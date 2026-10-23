-- schema_version 1 (data-spec 3-2). 이 파일은 배포 후 수정하지 않는다 — 변경은 새 마이그레이션 파일로.
-- 문장 구분: 줄 끝의 세미콜론(마이그레이션 실행기가 이 기준으로 나눈다).

CREATE TABLE category (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  color               TEXT NOT NULL CHECK (color IN ('c1','c2','c3','c4','c5','c6','c7','c8')),
  sort_order          INTEGER NOT NULL,
  nudge_snoozed_until TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE category_period (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  start_date  TEXT NOT NULL,
  end_date    TEXT,
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX ix_period_category ON category_period(category_id, start_date);

CREATE UNIQUE INDEX ux_period_open ON category_period(category_id) WHERE end_date IS NULL;

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

CREATE INDEX ix_item_cell ON entry_item(date, category_id, seq);

CREATE INDEX ix_item_category ON entry_item(category_id, date);

CREATE TABLE day_memo (
  date       TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  text       TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
  updated_at TEXT NOT NULL
);

CREATE TABLE weekly_summary (
  week_id           TEXT PRIMARY KEY CHECK (week_id GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'),
  ai_text           TEXT,
  ai_basis_hash     TEXT,
  ai_saved_at       TEXT,
  edited_text       TEXT,
  edited_basis_hash TEXT,
  edited_at         TEXT
);

CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
