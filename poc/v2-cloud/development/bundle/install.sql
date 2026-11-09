-- GENERATED DEVELOPMENT ONLY; manual authorized application.
BEGIN;
-- GENERATED REVIEW CANDIDATE. No automatic execution. All modules commit together.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- SOURCE poc/v2-cloud/session-guard.sql
-- REVIEW CANDIDATE C1. Not applied to the cloud. Run as the reviewed migration owner.
-- Only valid while Auth timebox/inactivity=0 and single-session=false are verified.
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

-- SOURCE poc/v2-gateway/postgres-metadata.sql
-- LOCAL / REVIEW CANDIDATE ONLY. Requires reviewed C1 session guard; no cloud apply.
CREATE SCHEMA wjb_gateway;
REVOKE ALL ON SCHEMA wjb_gateway FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE wjb_gateway.workspace (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, generation bigint NOT NULL CHECK(generation>0),
 quota_bytes bigint NOT NULL DEFAULT 1048576 CHECK(quota_bytes>0),
 used_bytes bigint NOT NULL DEFAULT 0 CHECK(used_bytes>=0 AND used_bytes<=quota_bytes)
);
CREATE TABLE wjb_gateway.device (
 id uuid PRIMARY KEY,user_id uuid NOT NULL,session_id uuid NOT NULL,revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE wjb_gateway.asset (
 workspace_id uuid NOT NULL REFERENCES wjb_gateway.workspace(id),id uuid NOT NULL,
 generation bigint NOT NULL,device_id uuid NOT NULL REFERENCES wjb_gateway.device(id),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 65536),
 state text NOT NULL CHECK(state IN ('reserved','ready','cleanup','canceled')),
 expires_at timestamptz NOT NULL,
 lease_token uuid,lease_fence bigint NOT NULL DEFAULT 0 CHECK(lease_fence>=0),lease_expires timestamptz,lease_mode text,
 io_version bigint NOT NULL DEFAULT 0 CHECK(io_version>=0),
 CHECK((lease_token IS NULL AND lease_expires IS NULL AND lease_mode IS NULL) OR
  (lease_token IS NOT NULL AND lease_expires IS NOT NULL AND lease_mode IS NOT NULL AND lease_mode IN ('read','write','cancel','recover'))),
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE wjb_gateway.io_intent (
 workspace_id uuid NOT NULL,asset_id uuid NOT NULL,id uuid NOT NULL,
 lease_token uuid NOT NULL,lease_fence bigint NOT NULL,user_id uuid NOT NULL,session_id uuid NOT NULL,
 settled boolean NOT NULL DEFAULT false,
 PRIMARY KEY(workspace_id,asset_id,id),
 FOREIGN KEY(workspace_id,asset_id) REFERENCES wjb_gateway.asset(workspace_id,id)
);
ALTER TABLE wjb_gateway.workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE wjb_gateway.device ENABLE ROW LEVEL SECURITY;
ALTER TABLE wjb_gateway.asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE wjb_gateway.io_intent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA wjb_gateway FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION wjb_gateway.asset_json(a wjb_gateway.asset) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('workspaceId',a.workspace_id,'assetId',a.id,'deviceId',a.device_id,
  'generation',a.generation::text,'sha256',a.sha256,'bytes',a.bytes,'state',a.state,
  'expires',extract(epoch FROM a.expires_at)*1000,'leaseToken',a.lease_token,
  'fence',a.lease_fence::text,'ioVersion',a.io_version::text)
$$;
CREATE FUNCTION public.wjb_v2_asset_command(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 v_action text:=p_request->>'action'; v_user uuid:=(p_request->>'userId')::uuid;
 v_session uuid:=(p_request->>'sessionId')::uuid; v_scope jsonb:=p_request->'scope';
 v_params jsonb:=coalesce(p_request->'params','{}'::jsonb);
 v_ws uuid:=(v_scope->>'workspaceId')::uuid; v_id uuid:=(v_scope->>'assetId')::uuid;
 v_device uuid:=(v_scope->>'deviceId')::uuid; v_generation bigint:=(v_scope->>'generation')::bigint;
 v_token uuid:=(v_params->>'token')::uuid; v_fence bigint:=(v_params->>'fence')::bigint;
 v_row wjb_gateway.asset%ROWTYPE; v_workspace wjb_gateway.workspace%ROWTYPE;
 v_intent wjb_gateway.io_intent%ROWTYPE; v_created boolean:=false; v_mode text:=v_params->>'mode';
 v_bytes integer; v_hash text; v_io uuid:=(v_params->>'intent')::uuid;
BEGIN
 IF v_action IS NULL OR v_action NOT IN ('reserve','acquire','recheck','mark_ready','mark_cleanup','mark_canceled','release','begin_io','settle_io','recover_ready') THEN
  RAISE EXCEPTION 'INVALID_ACTION'; END IF;
 IF v_user IS NULL OR v_session IS NULL OR v_ws IS NULL OR v_id IS NULL OR v_device IS NULL OR v_generation IS NULL OR v_generation<1 THEN
  RAISE EXCEPTION 'INVALID_SCOPE'; END IF;
 -- Bookkeeping can settle old I/O after revocation; never publishes user state.
 PERFORM 1 FROM wjb_gateway.device d WHERE d.id=v_device AND d.user_id=v_user AND d.session_id=v_session
  AND (v_action IN ('release','settle_io') OR NOT d.revoked) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF v_action NOT IN ('release','settle_io') AND NOT public.wjb_v2_session_active(v_user,v_session) THEN
  RAISE EXCEPTION 'ACCESS_REVOKED'; END IF;
 SELECT * INTO v_workspace FROM wjb_gateway.workspace WHERE id=v_ws AND owner_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF v_action NOT IN ('release','settle_io') AND v_workspace.generation<>v_generation THEN RAISE EXCEPTION 'GENERATION_CHANGED'; END IF;
 SELECT * INTO v_row FROM wjb_gateway.asset WHERE workspace_id=v_ws AND id=v_id FOR UPDATE;
 IF v_action='reserve' THEN
  v_bytes:=(v_params->>'bytes')::integer;v_hash:=v_params->>'sha256';
  IF v_bytes IS NULL OR v_bytes<1 OR v_bytes>65536 OR v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF FOUND THEN
   IF v_row.generation<>v_generation THEN RAISE EXCEPTION 'GENERATION_CHANGED'; END IF;
   IF v_row.device_id<>v_device THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
   IF v_row.bytes<>v_bytes OR v_row.sha256<>v_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
   IF v_row.state='canceled' THEN RAISE EXCEPTION 'ASSET_CANCELED'; END IF;
   IF v_row.state='cleanup' THEN RAISE EXCEPTION 'CLEANUP_PENDING'; END IF;
   IF v_row.state='reserved' AND v_row.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'UPLOAD_EXPIRED'; END IF;
  ELSE
   IF (SELECT count(*) FROM wjb_gateway.asset WHERE workspace_id=v_ws)>=256 THEN RAISE EXCEPTION 'ASSET_LIMIT'; END IF;
   IF v_workspace.used_bytes+v_bytes>v_workspace.quota_bytes THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
   UPDATE wjb_gateway.workspace SET used_bytes=used_bytes+v_bytes WHERE id=v_ws;
   INSERT INTO wjb_gateway.asset(workspace_id,id,generation,device_id,sha256,bytes,state,expires_at)
    VALUES(v_ws,v_id,v_generation,v_device,v_hash,v_bytes,'reserved',clock_timestamp()+interval '5 minutes') RETURNING * INTO v_row;
   v_created:=true;
  END IF;
  RETURN wjb_gateway.asset_json(v_row)||jsonb_build_object('created',v_created);
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'ASSET_NOT_FOUND'; END IF;
 IF v_row.generation<>v_generation THEN RAISE EXCEPTION 'GENERATION_CHANGED'; END IF;
 IF v_action='settle_io' THEN
  UPDATE wjb_gateway.io_intent SET settled=true WHERE workspace_id=v_ws AND asset_id=v_id AND id=v_io
   AND lease_token=v_token AND lease_fence=v_fence AND user_id=v_user AND session_id=v_session AND NOT settled;
  IF FOUND THEN UPDATE wjb_gateway.asset SET io_version=io_version+1 WHERE workspace_id=v_ws AND id=v_id RETURNING * INTO v_row; END IF;
  RETURN wjb_gateway.asset_json(v_row);
 END IF;
 IF v_action='release' THEN
  UPDATE wjb_gateway.asset SET lease_token=NULL,lease_expires=NULL,lease_mode=NULL
   WHERE workspace_id=v_ws AND id=v_id AND lease_token=v_token AND lease_fence=v_fence;
  RETURN jsonb_build_object('released',FOUND);
 END IF;
 IF v_action='acquire' THEN
  IF v_token IS NULL OR v_mode IS NULL OR v_mode NOT IN ('read','write','cancel','recover') THEN RAISE EXCEPTION 'INVALID_LEASE'; END IF;
  IF v_mode NOT IN ('read','recover') AND v_row.device_id<>v_device THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  IF v_mode NOT IN ('cancel','recover') AND v_row.state='reserved' AND v_row.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'UPLOAD_EXPIRED'; END IF;
  IF v_row.lease_token=v_token AND v_row.lease_expires>clock_timestamp() THEN
   IF v_row.lease_mode<>v_mode THEN RAISE EXCEPTION 'INVALID_LEASE'; END IF;
   RETURN wjb_gateway.asset_json(v_row); END IF;
  IF v_row.lease_expires>clock_timestamp() THEN RAISE EXCEPTION 'LEASE_BUSY'; END IF;
  UPDATE wjb_gateway.asset SET lease_token=v_token,lease_fence=lease_fence+1,
   lease_expires=clock_timestamp()+interval '30 seconds',lease_mode=v_mode WHERE workspace_id=v_ws AND id=v_id RETURNING * INTO v_row;
  RETURN wjb_gateway.asset_json(v_row);
 END IF;
 IF v_token IS NULL OR v_fence IS NULL OR v_row.lease_token IS DISTINCT FROM v_token OR v_row.lease_fence<>v_fence
  OR v_row.lease_expires IS NULL OR v_row.lease_expires<=clock_timestamp() THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
 IF v_row.lease_mode NOT IN ('read','recover') AND v_row.device_id<>v_device THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF v_row.lease_mode NOT IN ('cancel','recover') AND v_row.state='reserved' AND v_row.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'UPLOAD_EXPIRED'; END IF;
 IF v_action='recheck' THEN RETURN wjb_gateway.asset_json(v_row); END IF;
 IF v_action='begin_io' THEN
  IF v_row.lease_mode<>'write' OR v_row.state<>'reserved' OR v_io IS NULL THEN RAISE EXCEPTION 'ASSET_NOT_PENDING'; END IF;
  SELECT * INTO v_intent FROM wjb_gateway.io_intent WHERE workspace_id=v_ws AND asset_id=v_id AND id=v_io;
  IF FOUND THEN
   IF v_intent.lease_token<>v_token OR v_intent.lease_fence<>v_fence OR v_intent.user_id<>v_user OR v_intent.session_id<>v_session THEN RAISE EXCEPTION 'INVALID_INTENT'; END IF;
  ELSE
   IF (SELECT count(*) FROM wjb_gateway.io_intent WHERE workspace_id=v_ws AND asset_id=v_id)>=64 THEN RAISE EXCEPTION 'INTENT_LIMIT'; END IF;
   INSERT INTO wjb_gateway.io_intent VALUES(v_ws,v_id,v_io,v_token,v_fence,v_user,v_session,false);
   UPDATE wjb_gateway.asset SET io_version=io_version+1 WHERE workspace_id=v_ws AND id=v_id RETURNING * INTO v_row;
  END IF;
 ELSIF v_action='mark_ready' THEN
  IF v_row.lease_mode<>'write' OR v_row.state<>'reserved' THEN RAISE EXCEPTION 'ASSET_NOT_PENDING'; END IF;
  IF NOT EXISTS(SELECT 1 FROM wjb_gateway.io_intent WHERE workspace_id=v_ws AND asset_id=v_id AND lease_token=v_token AND lease_fence=v_fence AND settled) THEN RAISE EXCEPTION 'STORAGE_NOT_CONFIRMED'; END IF;
  UPDATE wjb_gateway.asset SET state='ready' WHERE workspace_id=v_ws AND id=v_id RETURNING * INTO v_row;
 ELSIF v_action='recover_ready' THEN
  IF v_row.lease_mode<>'recover' OR v_row.state<>'reserved' THEN RAISE EXCEPTION 'ASSET_NOT_PENDING'; END IF;
  IF (v_params->>'ioVersion') IS NULL OR (v_params->>'ioVersion')::bigint<>v_row.io_version THEN RAISE EXCEPTION 'CLEANUP_CHANGED'; END IF;
  IF v_params->>'sha256' IS DISTINCT FROM v_row.sha256 OR (v_params->>'bytes') IS NULL OR (v_params->>'bytes')::integer<>v_row.bytes THEN RAISE EXCEPTION 'STORAGE_NOT_CONFIRMED'; END IF;
  IF (v_params->>'decisionId') IS NULL OR coalesce(v_params->>'reviewHash','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  INSERT INTO wjb_gateway.recovery_audit(decision_id,workspace_id,asset_id,user_id,device_id,review_hash,action,io_version,result_state)
   VALUES((v_params->>'decisionId')::uuid,v_ws,v_id,v_user,v_device,v_params->>'reviewHash','RESTORE_READY',v_row.io_version,'ready');
  UPDATE wjb_gateway.asset SET state='ready' WHERE workspace_id=v_ws AND id=v_id RETURNING * INTO v_row;
 ELSIF v_action='mark_cleanup' THEN
  IF v_row.lease_mode NOT IN ('cancel','recover') OR v_row.state='ready' THEN RAISE EXCEPTION 'ASSET_ALREADY_READY'; END IF;
  IF v_row.lease_mode='recover' AND EXISTS(SELECT 1 FROM wjb_gateway.io_intent WHERE workspace_id=v_ws AND asset_id=v_id AND NOT settled) THEN RAISE EXCEPTION 'CLEANUP_UNCERTAIN'; END IF;
  IF v_row.state<>'canceled' THEN UPDATE wjb_gateway.asset SET state='cleanup' WHERE workspace_id=v_ws AND id=v_id RETURNING * INTO v_row; END IF;
 ELSIF v_action='mark_canceled' THEN
  IF v_row.lease_mode NOT IN ('cancel','recover') OR v_row.state<>'cleanup' THEN RAISE EXCEPTION 'ASSET_NOT_PENDING'; END IF;
  IF (v_params->>'ioVersion') IS NULL OR (v_params->>'ioVersion')::bigint<>v_row.io_version THEN RAISE EXCEPTION 'CLEANUP_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM wjb_gateway.io_intent WHERE workspace_id=v_ws AND asset_id=v_id AND NOT settled) THEN RAISE EXCEPTION 'CLEANUP_UNCERTAIN'; END IF;
  IF v_row.lease_mode='recover' THEN
   IF (v_params->>'decisionId') IS NULL OR coalesce(v_params->>'reviewHash','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
   INSERT INTO wjb_gateway.recovery_audit(decision_id,workspace_id,asset_id,user_id,device_id,review_hash,action,io_version,result_state)
    VALUES((v_params->>'decisionId')::uuid,v_ws,v_id,v_user,v_device,v_params->>'reviewHash','CANCEL',v_row.io_version,'canceled');
  END IF;
  UPDATE wjb_gateway.asset SET state='canceled' WHERE workspace_id=v_ws AND id=v_id RETURNING * INTO v_row;
  UPDATE wjb_gateway.workspace SET used_bytes=used_bytes-v_row.bytes WHERE id=v_ws;
 ELSE RAISE EXCEPTION 'INVALID_ACTION';
 END IF;
 RETURN wjb_gateway.asset_json(v_row);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wjb_gateway FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.wjb_v2_asset_command(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.wjb_v2_asset_command(jsonb) TO service_role;

-- SOURCE poc/v2-gateway/recovery.sql
-- LOCAL / REVIEW CANDIDATE. Requires the matching metadata schema and C1.
CREATE TABLE wjb_gateway.recovery_audit (
 decision_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,asset_id uuid NOT NULL,user_id uuid NOT NULL,device_id uuid NOT NULL,
 review_hash text NOT NULL CHECK(review_hash ~ '^[0-9a-f]{64}$'),
 action text NOT NULL CHECK(action IN ('RESTORE_READY','CANCEL')),
 io_version bigint NOT NULL,result_state text NOT NULL CHECK(result_state IN ('ready','canceled')),
 completed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(workspace_id,asset_id),FOREIGN KEY(workspace_id,asset_id) REFERENCES wjb_gateway.asset(workspace_id,id)
);
ALTER TABLE wjb_gateway.recovery_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wjb_gateway.recovery_audit FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.wjb_v2_recovery_catalog(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 v_user uuid:=(p_request->>'userId')::uuid;v_session uuid:=(p_request->>'sessionId')::uuid;
 v_ws uuid:=(p_request->'scope'->>'workspaceId')::uuid;v_device uuid:=(p_request->'scope'->>'deviceId')::uuid;
 v_generation bigint:=(p_request->'scope'->>'generation')::bigint;
 v_after uuid:=(p_request->>'after')::uuid;v_limit integer:=(p_request->>'limit')::integer;
 v_current bigint;v_items jsonb:='[]'::jsonb;v_row wjb_gateway.asset%ROWTYPE;v_count integer:=0;
 v_more boolean:=false;v_last uuid;v_receipt jsonb;
BEGIN
 IF v_user IS NULL OR v_session IS NULL OR v_ws IS NULL OR v_device IS NULL OR v_generation IS NULL
  OR v_limit IS NULL OR v_limit<1 OR v_limit>32 THEN RAISE EXCEPTION 'INVALID_SCOPE'; END IF;
 IF NOT public.wjb_v2_session_active(v_user,v_session) THEN RAISE EXCEPTION 'ACCESS_REVOKED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM wjb_gateway.device WHERE id=v_device AND user_id=v_user AND session_id=v_session AND NOT revoked) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT generation INTO v_current FROM wjb_gateway.workspace WHERE id=v_ws AND owner_id=v_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF v_current<>v_generation THEN RAISE EXCEPTION 'GENERATION_CHANGED'; END IF;
 FOR v_row IN SELECT * FROM wjb_gateway.asset WHERE workspace_id=v_ws AND (v_after IS NULL OR id>v_after) ORDER BY id LIMIT v_limit+1 LOOP
  IF v_count=v_limit THEN v_more:=true;EXIT;END IF;
  SELECT jsonb_build_object('decisionId',decision_id,'reviewHash',review_hash,'action',action,'resultState',result_state)
   INTO v_receipt FROM wjb_gateway.recovery_audit WHERE workspace_id=v_ws AND asset_id=v_row.id;
  v_items:=v_items||jsonb_build_array((wjb_gateway.asset_json(v_row)-'leaseToken')||jsonb_build_object(
   'unsettled',(SELECT count(*) FROM wjb_gateway.io_intent WHERE workspace_id=v_ws AND asset_id=v_row.id AND NOT settled),
   'busy',coalesce(v_row.lease_expires>statement_timestamp(),false),'receipt',v_receipt));
  v_last:=v_row.id;v_count:=v_count+1;
 END LOOP;
 RETURN jsonb_build_object('items',v_items,'hasMore',v_more,'nextCursor',CASE WHEN v_more THEN v_last ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.wjb_v2_recovery_catalog(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.wjb_v2_recovery_catalog(jsonb) TO service_role;
-- Development only. Mirrors woori-bldg 0012: pg_cron, daily singleton heartbeat.
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='keepalive_ping') THEN
  RAISE EXCEPTION 'KEEPALIVE_JOB_COLLISION'; END IF;
END$$;
CREATE TABLE public.keepalive_pings (
 id smallint PRIMARY KEY DEFAULT 1,
 pinged_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT keepalive_pings_singleton CHECK(id=1)
);
ALTER TABLE public.keepalive_pings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.keepalive_pings FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.keepalive_pings(id,pinged_at) VALUES(1,now());
SELECT cron.schedule('keepalive_ping','0 3 * * *',$job$
 INSERT INTO public.keepalive_pings(id,pinged_at) VALUES(1,now())
 ON CONFLICT(id) DO UPDATE SET pinged_at=excluded.pinged_at;
 DELETE FROM cron.job_run_details
 WHERE jobid IN(SELECT jobid FROM cron.job WHERE jobname='keepalive_ping' AND username=current_user)
 AND end_time < now()-interval '14 days';
$job$);
COMMIT;
