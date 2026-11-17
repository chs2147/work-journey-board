-- Back to before 028: drop the limit triggers, the account RPC and the ops schema (limits/admin/usage cache only —
-- no user data lives there). Existing functions were never replaced, so nothing else changes.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regnamespace('wjb_ops') IS NULL THEN RAISE EXCEPTION 'MIGRATION_028_REQUIRED'; END IF;
END $$;
DROP TRIGGER wjb_ops_space_insert ON wjb_gateway.workspace;
DROP TRIGGER wjb_ops_space_images ON wjb_gateway.workspace;
DROP TRIGGER wjb_ops_pub_ins ON wjb_migration.workspace_record;
DROP TRIGGER wjb_ops_pub_del ON wjb_migration.workspace_record;
DROP TRIGGER wjb_ops_sync_ins ON wjb_sync.record;
DROP TRIGGER wjb_ops_sync_upd ON wjb_sync.record;
DROP TRIGGER wjb_ops_sync_del ON wjb_sync.record;
DROP FUNCTION public.wjb_v2_account(jsonb);
DROP SCHEMA wjb_ops CASCADE;
COMMIT;
