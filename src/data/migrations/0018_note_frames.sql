-- Frame height metadata compatibility gate; also supports board sorting.
CREATE INDEX ix_cabi_board_updated_frame ON cabi_board(updated_at);
