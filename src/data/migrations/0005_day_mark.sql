-- 0005: 날짜 표시 — 연차·반차(docs/improve-1026-spec.md 1-2). 전진 전용 — 이 파일은 고치지 않는다.
-- 근무(기본)는 행이 없다. 표시를 근무로 돌리면 행을 지운다.

CREATE TABLE day_mark (
  date       TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind       TEXT NOT NULL CHECK (kind IN ('leave', 'half_am', 'half_pm')),
  updated_at TEXT NOT NULL
);
