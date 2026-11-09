-- Data-preserving pause after stopping external ingress. In-flight work may finish.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.wjb_v2_session_active(uuid,uuid),public.wjb_v2_revoke_session(uuid,uuid),
 public.wjb_v2_asset_command(jsonb),public.wjb_v2_recovery_catalog(jsonb) FROM service_role;
REVOKE EXECUTE ON FUNCTION wjb_v2_cloud.session_active(uuid,uuid),wjb_v2_cloud.revoke_session(uuid,uuid) FROM service_role;
REVOKE USAGE ON SCHEMA wjb_v2_cloud FROM service_role;
COMMIT;
