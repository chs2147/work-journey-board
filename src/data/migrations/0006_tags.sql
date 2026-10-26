-- 0006: 업무 태그(docs/improve-1026-spec.md 4-2). 전진 전용 — 이 파일은 고치지 않는다.
-- 태그는 업무에 붙는다(항목·날짜에는 없음). 이름의 `#`은 화면 표시용이라 저장하지 않는다.

CREATE TABLE tag (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 20),
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_tag_name ON tag(lower(name));

CREATE TABLE category_tag (
  category_id TEXT NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, tag_id)
);

CREATE INDEX ix_category_tag_tag ON category_tag(tag_id);
