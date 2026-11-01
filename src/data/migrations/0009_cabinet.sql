-- 0009: Cabinet — 자주 쓰는 작업 폴더·링크(docs/features-1102-spec.md F5). 전진 전용 — 이 파일은 고치지 않는다.
-- cabinet_item = 등록한 폴더(경로)·링크(http/https 주소). 앱은 폴더를 읽기·열기만 하고 파일을 지우거나 옮기지 않는다.
-- cabinet_link = 업무(category) 또는 업무 진행 항목(entry_item) 연결 — 둘 중 하나만.

CREATE TABLE cabinet_item (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('folder', 'link')),
  title      TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  target     TEXT NOT NULL CHECK (length(target) BETWEEN 1 AND 2048),
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE cabinet_link (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES cabinet_item(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES category(id) ON DELETE CASCADE,
  entry_id    TEXT REFERENCES entry_item(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  CHECK ((category_id IS NULL) <> (entry_id IS NULL))
);

CREATE UNIQUE INDEX ux_cabinet_link ON cabinet_link(item_id, ifnull(category_id, ''), ifnull(entry_id, ''));

CREATE INDEX ix_cabinet_link_category ON cabinet_link(category_id) WHERE category_id IS NOT NULL;

CREATE INDEX ix_cabinet_link_entry ON cabinet_link(entry_id) WHERE entry_id IS NOT NULL;
