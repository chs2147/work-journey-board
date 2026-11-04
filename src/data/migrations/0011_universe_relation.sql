-- 0011: Universe 직접 연결(docs/universe-spec.md 5-1·8-1, UV2). 전진 전용 — 이 파일은 고치지 않는다.
-- 주를 넘어 사용자가 직접 잇는 관계. 끝점은 같은 일지 안의 업무·태그·항목·메모 상자·Cabinet(종류 + id, 메모 상자는 주도 함께).
-- 기존 메모 연결(refs)·관계선(edges)·Cabinet 연결은 여기로 복사하지 않는다(읽을 때 투영 — 이중 관리 금지).
-- 원본이 지워져도 행은 남긴다(그리지 않을 뿐). 끊기는 deleted_at(되돌리기 가능).
CREATE TABLE universe_relation (
  id TEXT PRIMARY KEY,
  from_kind TEXT NOT NULL CHECK (from_kind IN ('category', 'tag', 'entry', 'note', 'cabinet')),
  from_id TEXT NOT NULL,
  from_week TEXT,
  to_kind TEXT NOT NULL CHECK (to_kind IN ('category', 'tag', 'entry', 'note', 'cabinet')),
  to_id TEXT NOT NULL,
  to_week TEXT,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('related', 'follow-up', 'supports', 'contradicts', 'supersedes')),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  CHECK (NOT (from_kind = to_kind AND from_id = to_id AND coalesce(from_week, '') = coalesce(to_week, '')))
);
CREATE INDEX ix_universe_relation_from ON universe_relation (from_kind, from_id);
CREATE INDEX ix_universe_relation_to ON universe_relation (to_kind, to_id);
