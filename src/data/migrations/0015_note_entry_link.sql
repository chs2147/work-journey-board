-- Cross-week memo links. JSON refs are migration input only; the table is authoritative.
CREATE TABLE note_entry_link (
  note_week_id TEXT NOT NULL REFERENCES week_note(week_id) ON DELETE CASCADE,
  box_id TEXT NOT NULL,
  entry_id TEXT NOT NULL REFERENCES entry_item(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (note_week_id, box_id, entry_id)
);
CREATE INDEX ix_note_entry_link_entry ON note_entry_link(entry_id);
INSERT OR IGNORE INTO note_entry_link (note_week_id, box_id, entry_id, created_at)
SELECT n.week_id, json_extract(b.value, '$.id'), e.id, n.updated_at
FROM week_note n, json_each(n.doc, '$.boxes') b,
     json_each(CASE WHEN json_type(b.value, '$.refs') = 'array' THEN json_extract(b.value, '$.refs')
                    WHEN json_type(b.value, '$.ref') = 'object' THEN json_array(json_extract(b.value, '$.ref')) ELSE '[]' END) r
JOIN entry_item e ON e.id = json_extract(r.value, '$.item')
WHERE json_type(b.value, '$.id') = 'text';

-- Keep the limit transactional even when a delayed memo save races a copy.
CREATE TRIGGER note_entry_link_limit BEFORE INSERT ON note_entry_link WHEN NOT EXISTS (SELECT 1 FROM note_entry_link WHERE note_week_id = NEW.note_week_id AND box_id = NEW.box_id AND entry_id = NEW.entry_id) AND (SELECT COUNT(*) FROM note_entry_link WHERE note_week_id = NEW.note_week_id AND box_id = NEW.box_id) >= 20 BEGIN SELECT RAISE(ABORT, '메모 연결은 객체당 20개까지 가능합니다.'); END;

CREATE TRIGGER note_entry_link_box BEFORE INSERT ON note_entry_link WHEN NOT EXISTS (SELECT 1 FROM week_note n, json_each(n.doc, '$.boxes') b WHERE n.week_id = NEW.note_week_id AND json_extract(b.value, '$.id') = NEW.box_id) BEGIN SELECT RAISE(ABORT, '원본 메모가 변경되었습니다. 다시 선택해 주세요.'); END;
