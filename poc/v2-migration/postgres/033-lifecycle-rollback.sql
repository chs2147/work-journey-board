-- Back to before 031: drop the two RPCs and the wjb_life schema. Only allowed while nothing was deleted through it
-- (no purge/account rows): spaces already deleted cannot be brought back by a rollback, so refuse instead.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regnamespace('wjb_life') IS NULL THEN RAISE EXCEPTION 'MIGRATION_031_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM wjb_life.purge) OR EXISTS(SELECT 1 FROM wjb_life.account_gone)
    OR EXISTS(SELECT 1 FROM wjb_life.orphan WHERE released) THEN RAISE EXCEPTION 'MIGRATION_031_IN_USE'; END IF;
END $$;
DROP FUNCTION public.wjb_v2_lifecycle(jsonb);
DROP FUNCTION public.wjb_v2_lifecycle_worker(jsonb);
DROP SCHEMA wjb_life CASCADE;
COMMIT;
