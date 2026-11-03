-- 0010: 항목 시작 시각(docs/improve-1103v8-spec.md T1). 전진 전용 — 이 파일은 고치지 않는다.
-- 그날 몇 시 몇 분에 시작하는 항목인지(예: 오전 10시 회의) — 'HH:MM', 분은 15분 단위만, 없으면 NULL.
ALTER TABLE entry_item ADD COLUMN start_time TEXT
  CHECK (start_time IS NULL OR (start_time GLOB '[0-2][0-9]:[0-5][0-9]'
    AND substr(start_time, 1, 2) <= '23' AND substr(start_time, 4, 2) IN ('00', '15', '30', '45')));
