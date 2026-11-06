-- Cabi.NET: date-independent notes and exactly one board per task. Existing tables stay intact.
CREATE TABLE cabi_note (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  plain_text TEXT NOT NULL DEFAULT '',
  format_version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_cabi_note_category ON cabi_note(category_id, updated_at);
CREATE TABLE cabi_board (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL UNIQUE REFERENCES category(id) ON DELETE RESTRICT,
  doc TEXT NOT NULL,
  format_version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  updated_at TEXT NOT NULL
);
CREATE TRIGGER cabi_note_revision BEFORE UPDATE ON cabi_note WHEN NEW.revision <> OLD.revision + 1 BEGIN SELECT RAISE(ABORT, 'CABI_CONFLICT'); END;
CREATE TRIGGER cabi_board_revision BEFORE UPDATE ON cabi_board WHEN NEW.revision <> OLD.revision + 1 BEGIN SELECT RAISE(ABORT, 'CABI_CONFLICT'); END;
CREATE TABLE cabi_asset (
  id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK(owner_kind IN ('note','board')),
  owner_id TEXT NOT NULL,
  mime TEXT NOT NULL CHECK(mime IN ('image/webp','image/png','image/jpeg','image/gif')),
  data TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  thumb TEXT,
  thumb_mime TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_cabi_asset_owner ON cabi_asset(owner_kind,owner_id);
CREATE TABLE cabi_entry_link (
  board_id TEXT NOT NULL REFERENCES cabi_board(id) ON DELETE CASCADE,
  box_id TEXT NOT NULL,
  entry_id TEXT NOT NULL REFERENCES entry_item(id) ON DELETE CASCADE,
  PRIMARY KEY(board_id,box_id,entry_id)
);
CREATE INDEX ix_cabi_entry_link_entry ON cabi_entry_link(entry_id);
CREATE TRIGGER cabi_entry_link_limit BEFORE INSERT ON cabi_entry_link WHEN NOT EXISTS(SELECT 1 FROM cabi_entry_link WHERE board_id=NEW.board_id AND box_id=NEW.box_id AND entry_id=NEW.entry_id) AND (SELECT COUNT(*) FROM cabi_entry_link WHERE board_id=NEW.board_id AND box_id=NEW.box_id)>=20 BEGIN SELECT RAISE(ABORT, '메모 연결은 객체당 20개까지 가능합니다.'); END;
CREATE TRIGGER cabi_entry_link_box BEFORE INSERT ON cabi_entry_link WHEN NOT EXISTS(SELECT 1 FROM cabi_board n,json_each(n.doc,'$.boxes') b WHERE n.id=NEW.board_id AND json_extract(b.value,'$.id')=NEW.box_id) BEGIN SELECT RAISE(ABORT, '원본 메모가 변경되었습니다. 다시 선택해 주세요.'); END;

CREATE TRIGGER cabi_asset_owner BEFORE INSERT ON cabi_asset WHEN (NEW.owner_kind='note' AND NOT EXISTS(SELECT 1 FROM cabi_note WHERE id=NEW.owner_id)) OR (NEW.owner_kind='board' AND NOT EXISTS(SELECT 1 FROM cabi_board WHERE id=NEW.owner_id)) BEGIN SELECT RAISE(ABORT, '이미지를 저장할 문서가 없습니다.'); END;
CREATE TRIGGER cabi_note_assets AFTER DELETE ON cabi_note BEGIN DELETE FROM cabi_asset WHERE owner_kind='note' AND owner_id=OLD.id; END;
CREATE TRIGGER cabi_board_assets AFTER DELETE ON cabi_board BEGIN DELETE FROM cabi_asset WHERE owner_kind='board' AND owner_id=OLD.id; END;
