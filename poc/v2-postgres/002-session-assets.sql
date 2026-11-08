-- LOCAL PoC extension; auth claims still come from the local bootstrap stub.
BEGIN;
SET LOCAL ROLE wjb_poc_owner;
CREATE TABLE wjb_v2.blocked_session (
  auth_session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL
);
ALTER TABLE wjb_v2.blocked_session ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION wjb_v2.register_device(p_device uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_session uuid; v_device wjb_v2.device_session%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_device IS NULL OR coalesce(auth.jwt()->>'session_id','') !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'INVALID_SESSION';
  END IF;
  v_session := (auth.jwt()->>'session_id')::uuid;
  -- Serializes registration and app-session revocation for this user.
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  IF EXISTS(SELECT 1 FROM wjb_v2.blocked_session WHERE auth_session_id=v_session) THEN
    RAISE EXCEPTION 'ACCESS_REVOKED';
  END IF;
  INSERT INTO wjb_v2.device_session VALUES(p_device,auth.uid(),v_session,false)
    ON CONFLICT(id) DO NOTHING;
  SELECT * INTO v_device FROM wjb_v2.device_session WHERE id=p_device FOR UPDATE;
  IF v_device.user_id<>auth.uid() OR v_device.auth_session_id<>v_session OR v_device.revoked THEN
    RAISE EXCEPTION 'ACCESS_REVOKED';
  END IF;
  RETURN jsonb_build_object('deviceId',p_device,'registered',true);
END $$;
CREATE FUNCTION wjb_v2.revoke_current_session() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_session uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF coalesce(auth.jwt()->>'session_id','') !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'INVALID_SESSION';
  END IF;
  v_session := (auth.jwt()->>'session_id')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  INSERT INTO wjb_v2.blocked_session VALUES(v_session,auth.uid()) ON CONFLICT DO NOTHING;
  UPDATE wjb_v2.device_session SET revoked=true WHERE user_id=auth.uid() AND auth_session_id=v_session;
END $$;

CREATE TABLE wjb_v2.asset (
  workspace_id uuid NOT NULL REFERENCES wjb_v2.workspace(id),
  id uuid NOT NULL,
  generation bigint NOT NULL,
  device_id uuid NOT NULL REFERENCES wjb_v2.device_session(id),
  expected_hash text NOT NULL CHECK(expected_hash ~ '^[0-9a-f]{64}$'),
  expected_bytes integer NOT NULL CHECK(expected_bytes BETWEEN 1 AND 65536),
  state text NOT NULL CHECK(state IN ('reserved','ready','canceled')),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(workspace_id,id)
);
-- Test double for private object bytes. This is NOT Supabase Storage.
CREATE TABLE wjb_v2.asset_bytes (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 65536),
  PRIMARY KEY(workspace_id,id),
  FOREIGN KEY(workspace_id,id) REFERENCES wjb_v2.asset(workspace_id,id)
);
ALTER TABLE wjb_v2.asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE wjb_v2.asset_bytes ENABLE ROW LEVEL SECURITY;
CREATE POLICY ready_asset_read ON wjb_v2.asset FOR SELECT TO authenticated USING (
  state='ready' AND wjb_v2.can_read(workspace_id)
  AND generation=(SELECT w.generation FROM wjb_v2.workspace w WHERE w.id=workspace_id)
);
CREATE POLICY ready_bytes_read ON wjb_v2.asset_bytes FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM wjb_v2.asset a WHERE a.workspace_id=asset_bytes.workspace_id AND a.id=asset_bytes.id)
);
CREATE FUNCTION wjb_v2.lock_asset_scope(p_workspace uuid,p_device uuid,p_generation bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_generation bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  PERFORM 1 FROM wjb_v2.device_session d WHERE d.id=p_device AND d.user_id=auth.uid()
    AND NOT d.revoked AND d.auth_session_id::text=auth.jwt()->>'session_id' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_REVOKED'; END IF;
  SELECT generation INTO v_generation FROM wjb_v2.workspace
    WHERE id=p_workspace AND owner_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_REVOKED'; END IF;
  IF p_generation IS DISTINCT FROM v_generation THEN RAISE EXCEPTION 'GENERATION_CHANGED'; END IF;
END $$;
CREATE FUNCTION wjb_v2.reserve_asset(p_workspace uuid,p_generation bigint,p_device uuid,
  p_asset uuid,p_hash text,p_bytes integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_asset wjb_v2.asset%ROWTYPE; v_total bigint;
BEGIN
  PERFORM wjb_v2.lock_asset_scope(p_workspace,p_device,p_generation);
  IF p_asset IS NULL OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$'
    OR p_bytes IS NULL OR p_bytes<1 OR p_bytes>65536 THEN RAISE EXCEPTION 'INVALID_ASSET'; END IF;
  SELECT * INTO v_asset FROM wjb_v2.asset WHERE workspace_id=p_workspace AND id=p_asset FOR UPDATE;
  IF FOUND THEN
    IF v_asset.generation<>p_generation OR v_asset.device_id<>p_device
      OR v_asset.expected_hash<>p_hash OR v_asset.expected_bytes<>p_bytes THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED';
    END IF;
    IF v_asset.state='canceled' THEN RAISE EXCEPTION 'ASSET_CANCELED'; END IF;
    IF v_asset.state='reserved' AND v_asset.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'UPLOAD_EXPIRED'; END IF;
    RETURN jsonb_build_object('assetId',p_asset,'state',v_asset.state);
  END IF;
  -- Local fixture quota 1MiB. Pending bytes count until explicit cancellation.
  SELECT coalesce(sum(expected_bytes),0) INTO v_total FROM wjb_v2.asset
    WHERE workspace_id=p_workspace AND state<>'canceled';
  IF v_total+p_bytes>1048576 THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
  INSERT INTO wjb_v2.asset VALUES(p_workspace,p_asset,p_generation,p_device,p_hash,p_bytes,'reserved',clock_timestamp()+interval '5 minutes');
  RETURN jsonb_build_object('assetId',p_asset,'state','reserved');
END $$;

-- Called only by local storage worker, never granted to authenticated.
CREATE FUNCTION wjb_v2.stage_asset_bytes(p_workspace uuid,p_asset uuid,p_payload bytea)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_asset wjb_v2.asset%ROWTYPE; v_existing bytea; v_generation bigint;
BEGIN
  SELECT generation INTO v_generation FROM wjb_v2.workspace WHERE id=p_workspace FOR UPDATE;
  SELECT * INTO v_asset FROM wjb_v2.asset WHERE workspace_id=p_workspace AND id=p_asset FOR UPDATE;
  IF NOT FOUND OR v_asset.state<>'reserved' THEN RAISE EXCEPTION 'ASSET_NOT_PENDING'; END IF;
  IF v_asset.generation<>v_generation THEN RAISE EXCEPTION 'GENERATION_CHANGED'; END IF;
  IF v_asset.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'UPLOAD_EXPIRED'; END IF;
  IF p_payload IS NULL OR octet_length(p_payload)<1 OR octet_length(p_payload)>65536 THEN RAISE EXCEPTION 'INVALID_ASSET'; END IF;
  SELECT payload INTO v_existing FROM wjb_v2.asset_bytes WHERE workspace_id=p_workspace AND id=p_asset;
  IF FOUND THEN
    IF v_existing IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'OBJECT_IMMUTABLE'; END IF;
    RETURN;
  END IF;
  INSERT INTO wjb_v2.asset_bytes VALUES(p_workspace,p_asset,p_payload);
END $$;
CREATE FUNCTION wjb_v2.finalize_asset(p_workspace uuid,p_generation bigint,p_device uuid,p_asset uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_asset wjb_v2.asset%ROWTYPE; v_payload bytea;
BEGIN
  PERFORM wjb_v2.lock_asset_scope(p_workspace,p_device,p_generation);
  SELECT * INTO v_asset FROM wjb_v2.asset WHERE workspace_id=p_workspace AND id=p_asset FOR UPDATE;
  IF NOT FOUND OR v_asset.device_id<>p_device THEN RAISE EXCEPTION 'ACCESS_REVOKED'; END IF;
  IF v_asset.generation<>p_generation THEN RAISE EXCEPTION 'GENERATION_CHANGED'; END IF;
  IF v_asset.state='canceled' THEN RAISE EXCEPTION 'ASSET_CANCELED'; END IF;
  IF v_asset.state='ready' THEN RETURN jsonb_build_object('assetId',p_asset,'state','ready'); END IF;
  IF v_asset.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'UPLOAD_EXPIRED'; END IF;
  SELECT payload INTO v_payload FROM wjb_v2.asset_bytes WHERE workspace_id=p_workspace AND id=p_asset;
  IF NOT FOUND THEN RAISE EXCEPTION 'UPLOAD_INCOMPLETE'; END IF;
  IF octet_length(v_payload)<>v_asset.expected_bytes THEN RAISE EXCEPTION 'SIZE_MISMATCH'; END IF;
  IF encode(sha256(v_payload),'hex')<>v_asset.expected_hash THEN RAISE EXCEPTION 'HASH_MISMATCH'; END IF;
  UPDATE wjb_v2.asset SET state='ready' WHERE workspace_id=p_workspace AND id=p_asset;
  RETURN jsonb_build_object('assetId',p_asset,'state','ready');
END $$;
CREATE FUNCTION wjb_v2.cancel_asset(p_workspace uuid,p_generation bigint,p_device uuid,p_asset uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_asset wjb_v2.asset%ROWTYPE;
BEGIN
  PERFORM wjb_v2.lock_asset_scope(p_workspace,p_device,p_generation);
  SELECT * INTO v_asset FROM wjb_v2.asset WHERE workspace_id=p_workspace AND id=p_asset FOR UPDATE;
  IF NOT FOUND OR v_asset.device_id<>p_device THEN RAISE EXCEPTION 'ACCESS_REVOKED'; END IF;
  IF v_asset.state='ready' THEN RAISE EXCEPTION 'ASSET_ALREADY_READY'; END IF;
  DELETE FROM wjb_v2.asset_bytes WHERE workspace_id=p_workspace AND id=p_asset;
  UPDATE wjb_v2.asset SET state='canceled' WHERE workspace_id=p_workspace AND id=p_asset;
END $$;
REVOKE ALL ON wjb_v2.blocked_session,wjb_v2.asset,wjb_v2.asset_bytes FROM PUBLIC,authenticated,anon;
REVOKE ALL ON FUNCTION wjb_v2.register_device(uuid),wjb_v2.revoke_current_session(),
  wjb_v2.lock_asset_scope(uuid,uuid,bigint),wjb_v2.reserve_asset(uuid,bigint,uuid,uuid,text,integer),
  wjb_v2.stage_asset_bytes(uuid,uuid,bytea),wjb_v2.finalize_asset(uuid,bigint,uuid,uuid),
  wjb_v2.cancel_asset(uuid,bigint,uuid,uuid) FROM PUBLIC,authenticated,anon;
GRANT SELECT ON wjb_v2.asset,wjb_v2.asset_bytes TO authenticated;
GRANT EXECUTE ON FUNCTION wjb_v2.register_device(uuid),wjb_v2.revoke_current_session(),
  wjb_v2.reserve_asset(uuid,bigint,uuid,uuid,text,integer),wjb_v2.finalize_asset(uuid,bigint,uuid,uuid),
  wjb_v2.cancel_asset(uuid,bigint,uuid,uuid) TO authenticated;
COMMIT;
