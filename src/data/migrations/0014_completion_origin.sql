-- Existing completions were all important. Preserve that origin for undo.
ALTER TABLE entry_item ADD COLUMN completion_was_flagged INTEGER NOT NULL DEFAULT 1 CHECK (completion_was_flagged IN (0, 1));
