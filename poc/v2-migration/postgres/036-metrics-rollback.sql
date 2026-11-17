-- Back to before 034: drop the daily metric table and snapshot function (measurement only — no user data).
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regclass('wjb_ops.metric_day') IS NULL THEN RAISE EXCEPTION 'MIGRATION_034_REQUIRED'; END IF;
END $$;
DROP FUNCTION wjb_ops.snapshot_metrics(date);
DROP TABLE wjb_ops.metric_day;
COMMIT;
