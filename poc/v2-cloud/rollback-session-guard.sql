-- Manual C1 rollback only, after freezing gateway traffic and preserving revocations.
BEGIN;
DO $$
BEGIN
  IF current_setting('wjb.confirm_cloud_rollback',true) IS DISTINCT FROM
    'hutqsfftioxtredcjhsy:no-active-traffic' THEN RAISE EXCEPTION 'ROLLBACK_CONFIRMATION_REQUIRED'; END IF;
END $$;
DROP FUNCTION public.wjb_v2_session_active(uuid,uuid);
DROP FUNCTION public.wjb_v2_revoke_session(uuid,uuid);
DROP FUNCTION wjb_v2_cloud.session_active(uuid,uuid);
DROP FUNCTION wjb_v2_cloud.revoke_session(uuid,uuid);
DROP TABLE wjb_v2_cloud.blocked_session;
DROP SCHEMA wjb_v2_cloud;
COMMIT;
