-- REVIEW ONLY; no cloud auto-apply. Development project only (docs/v2-design/102 G-6 비용·성능 측정, 결정 G-D5).
-- Apply once after 031. One row per day of what the server itself can see — sizes, counts and how much was written that
-- day. No record content, no e-mail, no per-user rows (only totals). Egress and Edge invocations are not visible to SQL
-- and are read from the dashboard Usage page. Existing functions/tables are NOT replaced.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF to_regnamespace('wjb_life') IS NULL THEN RAISE EXCEPTION 'MIGRATION_031_REQUIRED'; END IF;
 IF to_regclass('wjb_ops.metric_day') IS NOT NULL THEN RAISE EXCEPTION 'MIGRATION_034_ALREADY_APPLIED'; END IF;
END $$;
CREATE TABLE wjb_ops.metric_day(
 day date PRIMARY KEY,
 db_bytes bigint NOT NULL,
 image_bytes bigint NOT NULL,          -- 계정 사용량 합(서버가 확인한 그림)
 storage_objects bigint,               -- 저장소 객체 수(Supabase storage가 있을 때)
 storage_bytes bigint,
 accounts integer NOT NULL,
 spaces integer NOT NULL,
 synced_spaces integer NOT NULL,
 records bigint NOT NULL,              -- 지금 기록 행(지움 표시 뺌)
 tombstones bigint NOT NULL,           -- 지움 표시 행(③ 정리 판단용)
 changes_day bigint NOT NULL,          -- 그날 서버에 들어온 기록 변경(updated_at 기준)
 pushes_day bigint NOT NULL,           -- 그날 적용한 보내기 요청
 devices_day bigint NOT NULL,          -- 그날 보낸 기기 수
 images_declared_day bigint NOT NULL,  -- 그날 새로 신고한 그림
 images_released bigint NOT NULL,      -- 안 쓰는 그림으로 넘긴 누적
 at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE wjb_ops.metric_day ENABLE ROW LEVEL SECURITY;

-- 오늘(또는 p_day) 한 줄을 다시 계산해 넣는다(여러 번 불러도 한 줄)
CREATE FUNCTION wjb_ops.snapshot_metrics(p_day date DEFAULT current_date) RETURNS wjb_ops.metric_day
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r wjb_ops.metric_day;o bigint;ob bigint;
 lo timestamptz:=p_day::timestamptz;hi timestamptz:=(p_day+1)::timestamptz;
BEGIN
 IF to_regclass('storage.objects') IS NOT NULL THEN
  EXECUTE 'SELECT count(*),coalesce(sum((metadata->>''size'')::bigint),0) FROM storage.objects WHERE bucket_id LIKE ''wjb-v2-%''' INTO o,ob;
 END IF;
 INSERT INTO wjb_ops.metric_day(day,db_bytes,image_bytes,storage_objects,storage_bytes,accounts,spaces,synced_spaces,records,tombstones,
   changes_day,pushes_day,devices_day,images_declared_day,images_released)
 SELECT p_day,pg_database_size(current_database()),
  (SELECT coalesce(sum(used_bytes),0) FROM wjb_gateway.workspace),o,ob,
  (SELECT count(DISTINCT owner_id) FROM wjb_migration.job WHERE state='connected'),
  (SELECT count(*) FROM wjb_migration.job WHERE state='connected'),
  (SELECT count(*) FROM wjb_sync.space),
  (SELECT count(*) FROM wjb_sync.record WHERE value IS NOT NULL),
  (SELECT count(*) FROM wjb_sync.record WHERE value IS NULL),
  (SELECT count(*) FROM wjb_sync.record WHERE rev>0 AND updated_at>=lo AND updated_at<hi),
  (SELECT count(*) FROM wjb_sync.applied WHERE created_at>=lo AND created_at<hi),
  (SELECT count(DISTINCT device_id) FROM wjb_sync.applied WHERE created_at>=lo AND created_at<hi),
  (SELECT count(*) FROM wjb_sync.asset_declared WHERE created_at>=lo AND created_at<hi),
  (SELECT count(*) FROM wjb_life.orphan WHERE released)
 ON CONFLICT(day) DO UPDATE SET db_bytes=excluded.db_bytes,image_bytes=excluded.image_bytes,storage_objects=excluded.storage_objects,
  storage_bytes=excluded.storage_bytes,accounts=excluded.accounts,spaces=excluded.spaces,synced_spaces=excluded.synced_spaces,
  records=excluded.records,tombstones=excluded.tombstones,changes_day=excluded.changes_day,pushes_day=excluded.pushes_day,
  devices_day=excluded.devices_day,images_declared_day=excluded.images_declared_day,images_released=excluded.images_released,at=clock_timestamp()
 RETURNING * INTO r;
 RETURN r;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wjb_ops FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA wjb_ops FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
