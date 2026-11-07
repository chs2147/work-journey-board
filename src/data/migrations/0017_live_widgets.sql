-- Live widget capability gate: old apps must not rewrite task-board widget metadata.
CREATE INDEX ix_entry_widget_category_date ON entry_item(category_id,date,seq);
CREATE INDEX ix_entry_widget_important ON entry_item(category_id,flagged,flag_done_at,due_date);
