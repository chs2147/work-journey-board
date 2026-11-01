-- 0007: 메모 이미지 표시용 작은 그림(docs/optimize-1031-plan.md O2). 전진 전용 — 이 파일은 고치지 않는다.
-- 원본(data)은 그대로 두고, 메모 판에는 긴 변 800px 이하 사본만 읽어 그린다(1년치 일지에서 주를 오갈 때 메모리 증가 방지).
-- 원본이 이미 작으면 thumb은 비어 있고 원본을 그대로 쓴다. 기존 이미지는 처음 볼 때 만들어 채운다.

ALTER TABLE note_asset ADD COLUMN thumb TEXT;

ALTER TABLE note_asset ADD COLUMN thumb_mime TEXT CHECK (thumb_mime IS NULL OR thumb_mime IN ('image/webp', 'image/png'));
