-- 0004: 기존 일지 가져오기(docs/i-m3-plan.md 3-9). 전진 전용 — 이 파일은 고치지 않는다.
-- 가져온 행에는 가져오기 id를 달아 [되돌리기]가 그 묶음만 정확히 빼고, 덮어쓰기로 지운 행은 undo_json으로 되살린다.

CREATE TABLE import_batch (
  id          TEXT PRIMARY KEY,
  file_name   TEXT NOT NULL,
  week_count  INTEGER NOT NULL,
  item_count  INTEGER NOT NULL,
  undo_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  undone_at   TEXT
);

ALTER TABLE entry_item ADD COLUMN import_id TEXT REFERENCES import_batch(id);

CREATE INDEX ix_item_import ON entry_item(import_id) WHERE import_id IS NOT NULL;
