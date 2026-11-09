-- 개선 v20(improve-v20-spec 2절): 업무노트 삭제 잠금. 기존 노트는 모두 잠금 꺼짐.
ALTER TABLE cabi_note ADD COLUMN delete_locked INTEGER NOT NULL DEFAULT 0 CHECK (delete_locked IN (0, 1));
-- 잠금은 본문 revision과 따로 바꾼다(열린 편집 창과 충돌하지 않게) — revision 검사는 본문·제목·업무 열에만.
DROP TRIGGER cabi_note_revision;
CREATE TRIGGER cabi_note_revision BEFORE UPDATE OF title, content, plain_text, format_version, category_id, revision ON cabi_note WHEN NEW.revision <> OLD.revision + 1 BEGIN SELECT RAISE(ABORT, 'CABI_CONFLICT'); END;
