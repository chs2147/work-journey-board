-- Empty-only uninstall. Stop ingress first; never use this to purge production data.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $$BEGIN
 IF current_setting('wjb.confirm_bundle_rollback',true) IS DISTINCT FROM 'hutqsfftioxtredcjhsy:traffic-stopped' THEN
  RAISE EXCEPTION 'ROLLBACK_CONFIRMATION_REQUIRED'; END IF;
END$$;
LOCK TABLE wjb_v2_cloud.blocked_session,wjb_gateway.workspace,wjb_gateway.device,wjb_gateway.asset,wjb_gateway.io_intent,wjb_gateway.recovery_audit IN ACCESS EXCLUSIVE MODE;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM wjb_v2_cloud.blocked_session) OR EXISTS(SELECT 1 FROM wjb_gateway.workspace)
  OR EXISTS(SELECT 1 FROM wjb_gateway.device) OR EXISTS(SELECT 1 FROM wjb_gateway.asset)
  OR EXISTS(SELECT 1 FROM wjb_gateway.io_intent) OR EXISTS(SELECT 1 FROM wjb_gateway.recovery_audit) THEN
  RAISE EXCEPTION 'BUNDLE_DATA_PRESENT'; END IF;
END$$;
DROP FUNCTION public.wjb_v2_recovery_catalog(jsonb);
DROP FUNCTION public.wjb_v2_asset_command(jsonb);
DROP FUNCTION public.wjb_v2_revoke_session(uuid,uuid);
DROP FUNCTION public.wjb_v2_session_active(uuid,uuid);
DROP FUNCTION wjb_gateway.asset_json(wjb_gateway.asset);
DROP FUNCTION wjb_v2_cloud.revoke_session(uuid,uuid);
DROP FUNCTION wjb_v2_cloud.session_active(uuid,uuid);
DROP TABLE wjb_gateway.recovery_audit;
DROP TABLE wjb_gateway.io_intent;
DROP TABLE wjb_gateway.asset;
DROP TABLE wjb_gateway.device;
DROP TABLE wjb_gateway.workspace;
DROP TABLE wjb_v2_cloud.blocked_session;
DROP SCHEMA wjb_gateway;
DROP SCHEMA wjb_v2_cloud;
COMMIT;
