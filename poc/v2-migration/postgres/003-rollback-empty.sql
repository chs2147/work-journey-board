-- Only for a completely unused new module. No data deletion or CASCADE.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM wjb_migration.job) OR EXISTS(SELECT 1 FROM wjb_migration.asset) OR
    EXISTS(SELECT 1 FROM wjb_migration.document) THEN RAISE EXCEPTION 'MIGRATION_ROLLBACK_NOT_EMPTY'; END IF;
END $$;
DROP TRIGGER wjb_migration_asset_gate ON wjb_gateway.asset;
DROP FUNCTION public.wjb_v2_migration_command(jsonb);
DROP FUNCTION wjb_migration.asset_gate();
DROP FUNCTION wjb_migration.receipt(wjb_migration.job);
DROP FUNCTION wjb_migration.current_manifest(uuid);
DROP FUNCTION wjb_migration.normalize(jsonb);
DROP FUNCTION wjb_migration.keys_exact(jsonb,text[]);
DROP TABLE wjb_migration.document;
DROP TABLE wjb_migration.asset;
DROP TABLE wjb_migration.job;
DROP SCHEMA wjb_migration;
COMMIT;
