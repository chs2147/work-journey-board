-- REVIEW CANDIDATE C1. Not applied to the cloud. Run as the reviewed migration owner.
-- Only valid while Auth timebox/inactivity=0 and single-session=false are verified.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN RAISE EXCEPTION 'SERVICE_ROLE_MISSING'; END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('sessions','id','uuid'),('sessions','user_id','uuid'),('sessions','not_after','timestamp with time zone'),
      ('users','id','uuid'),('users','banned_until','timestamp with time zone'),('users','deleted_at','timestamp with time zone')
    ) wanted(tbl,col,typ)
    WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='auth'
      AND c.table_name=wanted.tbl AND c.column_name=wanted.col AND c.data_type=wanted.typ)
  ) THEN RAISE EXCEPTION 'AUTH_SCHEMA_NOT_SUPPORTED'; END IF;
END $$;
-- Deliberately no IF NOT EXISTS/OR REPLACE: collisions fail atomically.
CREATE SCHEMA wjb_v2_cloud;
REVOKE ALL ON SCHEMA wjb_v2_cloud FROM PUBLIC,anon,authenticated;
CREATE TABLE wjb_v2_cloud.blocked_session (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE wjb_v2_cloud.blocked_session ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wjb_v2_cloud.blocked_session FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION wjb_v2_cloud.session_active(p_user uuid,p_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT p_user IS NOT NULL AND p_session IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id
    WHERE s.id=p_session AND s.user_id=p_user
      AND (s.not_after IS NULL OR s.not_after>statement_timestamp())
      AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
      AND NOT EXISTS(SELECT 1 FROM wjb_v2_cloud.blocked_session b WHERE b.session_id=s.id)
  )
$$;
CREATE FUNCTION wjb_v2_cloud.revoke_session(p_user uuid,p_session uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_existing uuid;
BEGIN
  IF p_user IS NULL OR p_session IS NULL THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_session::text,0));
  IF EXISTS(SELECT 1 FROM auth.sessions WHERE id=p_session AND user_id<>p_user) THEN
    RAISE EXCEPTION 'SESSION_SUBJECT_MISMATCH';
  END IF;
  SELECT user_id INTO v_existing FROM wjb_v2_cloud.blocked_session WHERE session_id=p_session;
  IF FOUND AND v_existing<>p_user THEN RAISE EXCEPTION 'SESSION_SUBJECT_MISMATCH'; END IF;
  INSERT INTO wjb_v2_cloud.blocked_session(session_id,user_id) VALUES(p_session,p_user)
    ON CONFLICT(session_id) DO NOTHING;
END $$;
-- Public RPC wrappers are INVOKER functions; only the server role can execute.
CREATE FUNCTION public.wjb_v2_session_active(p_user uuid,p_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT wjb_v2_cloud.session_active(p_user,p_session)
$$;
CREATE FUNCTION public.wjb_v2_revoke_session(p_user uuid,p_session uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT wjb_v2_cloud.revoke_session(p_user,p_session)
$$;
REVOKE ALL ON FUNCTION wjb_v2_cloud.session_active(uuid,uuid),wjb_v2_cloud.revoke_session(uuid,uuid),
  public.wjb_v2_session_active(uuid,uuid),public.wjb_v2_revoke_session(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA wjb_v2_cloud TO service_role;
GRANT EXECUTE ON FUNCTION wjb_v2_cloud.session_active(uuid,uuid),wjb_v2_cloud.revoke_session(uuid,uuid),
  public.wjb_v2_session_active(uuid,uuid),public.wjb_v2_revoke_session(uuid,uuid) TO service_role;
COMMIT;
