-- Manual resume of the same reviewed bundle only. Never grants client/public access.
BEGIN;
DO $$BEGIN
 IF current_setting('wjb.confirm_bundle_resume',true) IS DISTINCT FROM 'hutqsfftioxtredcjhsy:reviewed' THEN
  RAISE EXCEPTION 'RESUME_CONFIRMATION_REQUIRED'; END IF;
END$$;
GRANT USAGE ON SCHEMA wjb_v2_cloud TO service_role;
GRANT EXECUTE ON FUNCTION wjb_v2_cloud.session_active(uuid,uuid),wjb_v2_cloud.revoke_session(uuid,uuid),
 public.wjb_v2_session_active(uuid,uuid),public.wjb_v2_revoke_session(uuid,uuid),
 public.wjb_v2_asset_command(jsonb),public.wjb_v2_recovery_catalog(jsonb) TO service_role;
COMMIT;
