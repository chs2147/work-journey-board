-- Back to 016: drop the sync RPC and the wjb_sync schema — only while no device has pushed a change
-- (synced copies of published records only). Published migration data (wjb_migration) is untouched.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regnamespace('wjb_sync') IS NULL THEN RAISE EXCEPTION 'MIGRATION_019_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM wjb_sync.applied) OR EXISTS(SELECT 1 FROM wjb_sync.asset_declared) OR EXISTS(SELECT 1 FROM wjb_sync.record WHERE rev>0) THEN RAISE EXCEPTION 'SYNC_HAS_CHANGES'; END IF;
END $$;
DROP FUNCTION public.wjb_v2_workspace_sync(jsonb);
-- exact 001 migration asset gate
CREATE OR REPLACE FUNCTION wjb_migration.asset_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j wjb_migration.job;
BEGIN
 SELECT * INTO j FROM wjb_migration.job WHERE workspace_id=NEW.workspace_id;
 IF FOUND AND (j.state<>'staging' OR NOT EXISTS(SELECT 1 FROM wjb_migration.asset a WHERE a.job_id=j.id
   AND a.object_id=NEW.id AND a.sha256=NEW.sha256 AND a.bytes=NEW.bytes)) THEN RAISE EXCEPTION 'MIGRATION_ASSET_NOT_DECLARED'; END IF;
 RETURN NEW;
END $$;
DROP SCHEMA wjb_sync CASCADE;
COMMIT;
