-- 0012: 지식 카드(docs/universe-spec.md 5-2·8-1, UV3). 전진 전용 — 이 파일은 고치지 않는다.
-- 여러 기록에서 얻은 해결법·의사결정·배운 점·업무 길잡이를 정리한 카드. 원문은 복사해 고치지 않고 출처마다 "당시 발췌" + 지문만 남긴다.
-- 지우기 = deleted_at(되돌리기 가능). 출처는 다형 끝점이라 DB FK 대신 저장소가 검사하고, 원문이 지워져도 출처 행은 남는다(읽을 때 "원문 없음").
CREATE TABLE knowledge_card (
  id TEXT PRIMARY KEY,
  card_type TEXT NOT NULL CHECK (card_type IN ('solution', 'decision', 'learning', 'guide')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 300),
  conditions TEXT NOT NULL DEFAULT '' CHECK (length(conditions) <= 1000),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 10000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  deleted_at TEXT
);
CREATE TABLE knowledge_card_category (
  card_id TEXT NOT NULL REFERENCES knowledge_card (id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES category (id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, category_id)
);
CREATE TABLE knowledge_card_source (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES knowledge_card (id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('entry', 'note', 'cabinet', 'category', 'tag')),
  source_id TEXT NOT NULL,
  source_week TEXT,
  excerpt TEXT NOT NULL DEFAULT '' CHECK (length(excerpt) <= 2000),
  content_fp TEXT NOT NULL,
  location_fp TEXT NOT NULL,
  locator_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL,
  captured_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_knowledge_card_source ON knowledge_card_source (card_id, source_kind, ifnull(source_week, ''), source_id);
CREATE INDEX ix_knowledge_card_source_ref ON knowledge_card_source (source_kind, source_id);
