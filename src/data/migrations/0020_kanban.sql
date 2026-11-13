-- 0020: 칸반 보드(docs/improve-v21-spec.md 10절). 전진 전용 — 이 파일은 고치지 않는다.
-- 사용자 섹션(TODO·DONE은 행 없음) · 항목의 섹션 · 상태 변경 이력 · 일괄 완료 되돌리기 자료.
CREATE TABLE kanban_section (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
  color      TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE entry_item ADD COLUMN kanban_section_id TEXT REFERENCES kanban_section(id) ON DELETE SET NULL;

CREATE INDEX ix_item_kanban_section ON entry_item(kanban_section_id) WHERE kanban_section_id IS NOT NULL;

-- 이력은 항목을 지워도 남긴다(삭제 되돌리기로 같은 id가 돌아오면 이어진다) — 외래 키 없음.
CREATE TABLE item_status_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    TEXT NOT NULL,
  from_key   TEXT NOT NULL,
  from_name  TEXT NOT NULL,
  to_key     TEXT NOT NULL,
  to_name    TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('kanban', 'board', 'important', 'bulk', 'section', 'import', 'migrate')),
  batch_id   TEXT
);

CREATE INDEX ix_status_item ON item_status_log(item_id, changed_at);

-- 지금 쓰기의 출처(한 줄) — 저장소가 batch 첫 문장에서 바꾸고 마지막 문장에서 'board'로 되돌린다.
CREATE TABLE kanban_ctx (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  source   TEXT NOT NULL,
  batch_id TEXT,
  at       TEXT
);

INSERT INTO kanban_ctx (id, source, batch_id, at) VALUES (1, 'board', NULL, NULL);

CREATE TABLE kanban_bulk (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  count      INTEGER NOT NULL,
  items      TEXT NOT NULL,
  undone_at  TEXT
);

-- 본 항목의 섹션(todo / done / 사용자 섹션 id)이 바뀌면 이력 한 줄
CREATE TRIGGER entry_item_status_log AFTER UPDATE OF flagged, flag_done_at, kanban_section_id ON entry_item
WHEN NEW.depth = 0
  AND (CASE WHEN OLD.flagged = 0 AND OLD.flag_done_at IS NOT NULL THEN 'done'
            WHEN OLD.kanban_section_id IS NOT NULL THEN OLD.kanban_section_id ELSE 'todo' END)
   <> (CASE WHEN NEW.flagged = 0 AND NEW.flag_done_at IS NOT NULL THEN 'done'
            WHEN NEW.kanban_section_id IS NOT NULL THEN NEW.kanban_section_id ELSE 'todo' END)
BEGIN
  INSERT INTO item_status_log (item_id, from_key, from_name, to_key, to_name, changed_at, source, batch_id)
  SELECT NEW.id, f.k, CASE f.k WHEN 'todo' THEN 'TODO' WHEN 'done' THEN 'DONE'
                         ELSE COALESCE((SELECT name FROM kanban_section WHERE id = f.k), '(지운 섹션)') END,
         t.k, CASE t.k WHEN 'todo' THEN 'TODO' WHEN 'done' THEN 'DONE'
                         ELSE COALESCE((SELECT name FROM kanban_section WHERE id = t.k), '(지운 섹션)') END,
         COALESCE(c.at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), c.source, c.batch_id
  FROM (SELECT CASE WHEN OLD.flagged = 0 AND OLD.flag_done_at IS NOT NULL THEN 'done'
                    WHEN OLD.kanban_section_id IS NOT NULL THEN OLD.kanban_section_id ELSE 'todo' END AS k) f,
       (SELECT CASE WHEN NEW.flagged = 0 AND NEW.flag_done_at IS NOT NULL THEN 'done'
                    WHEN NEW.kanban_section_id IS NOT NULL THEN NEW.kanban_section_id ELSE 'todo' END AS k) t,
       kanban_ctx c WHERE c.id = 1; END;

-- 지금까지 완료한 본 항목은 완료 시각으로 TODO → DONE 한 줄을 채운다
INSERT INTO item_status_log (item_id, from_key, from_name, to_key, to_name, changed_at, source, batch_id)
SELECT id, 'todo', 'TODO', 'done', 'DONE', flag_done_at, 'migrate', NULL
FROM entry_item WHERE depth = 0 AND flagged = 0 AND flag_done_at IS NOT NULL;
