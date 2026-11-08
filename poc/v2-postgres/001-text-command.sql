-- Experimental PostgreSQL slice, NOT a production Supabase migration.
-- Expects pre-provisioned roles/schema; see bootstrap-local.sql for local harness.
BEGIN;
SET LOCAL ROLE wjb_poc_owner;
REVOKE ALL ON SCHEMA wjb_v2 FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA wjb_v2 REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE wjb_v2.workspace (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0),
  cursor bigint NOT NULL DEFAULT 0 CHECK (cursor >= 0)
);
CREATE TABLE wjb_v2.device_session (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  auth_session_id uuid NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE wjb_v2.text_record (
  workspace_id uuid NOT NULL REFERENCES wjb_v2.workspace(id),
  id uuid NOT NULL,
  body text NOT NULL CHECK (octet_length(body) <= 16384),
  revision bigint NOT NULL CHECK (revision > 0),
  PRIMARY KEY (workspace_id, id)
);
CREATE TABLE wjb_v2.applied_operation (
  workspace_id uuid NOT NULL REFERENCES wjb_v2.workspace(id),
  generation bigint NOT NULL,
  device_id uuid NOT NULL REFERENCES wjb_v2.device_session(id),
  op_id uuid NOT NULL,
  request jsonb NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (workspace_id, generation, device_id, op_id)
);
CREATE TABLE wjb_v2.change_log (
  workspace_id uuid NOT NULL REFERENCES wjb_v2.workspace(id),
  cursor bigint NOT NULL,
  generation bigint NOT NULL,
  record_id uuid NOT NULL,
  revision bigint NOT NULL,
  body text NOT NULL,
  PRIMARY KEY (workspace_id, cursor)
);
CREATE FUNCTION wjb_v2.can_read(p_workspace uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM wjb_v2.workspace w
    WHERE w.id = p_workspace AND w.owner_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM wjb_v2.device_session d
        WHERE d.user_id = auth.uid() AND NOT d.revoked
          AND d.auth_session_id::text = auth.jwt()->>'session_id'
      )
  )
$$;
ALTER TABLE wjb_v2.workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE wjb_v2.device_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE wjb_v2.text_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE wjb_v2.applied_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE wjb_v2.change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_read ON wjb_v2.workspace FOR SELECT TO authenticated
  USING (wjb_v2.can_read(id));
CREATE POLICY record_read ON wjb_v2.text_record FOR SELECT TO authenticated
  USING (wjb_v2.can_read(workspace_id));
CREATE POLICY change_read ON wjb_v2.change_log FOR SELECT TO authenticated
  USING (wjb_v2.can_read(workspace_id));

CREATE FUNCTION wjb_v2.put_text(
  p_workspace uuid, p_generation bigint, p_device uuid, p_op uuid,
  p_record uuid, p_expected_revision bigint, p_body text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_workspace wjb_v2.workspace%ROWTYPE;
  v_op wjb_v2.applied_operation%ROWTYPE;
  v_revision bigint;
  v_cursor bigint;
  v_request jsonb;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='AUTH_REQUIRED';
  END IF;
  -- Shared device lock serializes revocation against accepted in-flight writes.
  PERFORM 1 FROM wjb_v2.device_session d
    WHERE d.id=p_device AND d.user_id=auth.uid() AND NOT d.revoked
      AND d.auth_session_id::text=auth.jwt()->>'session_id' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ACCESS_REVOKED';
  END IF;
  SELECT * INTO v_workspace FROM wjb_v2.workspace
    WHERE id=p_workspace AND owner_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ACCESS_REVOKED';
  END IF;
  IF p_generation IS DISTINCT FROM v_workspace.generation THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='GENERATION_CHANGED';
  END IF;
  IF p_op IS NULL OR p_record IS NULL OR p_body IS NULL
    OR p_expected_revision IS NULL OR p_expected_revision < 0
    OR octet_length(p_body)>16384 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='INVALID_COMMAND';
  END IF;
  v_request := jsonb_build_object('record',p_record,'expected',p_expected_revision,'body',p_body);
  SELECT * INTO v_op FROM wjb_v2.applied_operation
    WHERE workspace_id=p_workspace AND generation=p_generation
      AND device_id=p_device AND op_id=p_op;
  IF FOUND THEN
    IF v_op.request IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='IDEMPOTENCY_KEY_REUSED';
    END IF;
    RETURN v_op.result;
  END IF;
  SELECT revision INTO v_revision FROM wjb_v2.text_record
    WHERE workspace_id=p_workspace AND id=p_record;
  v_revision := coalesce(v_revision,0);
  IF v_revision<>p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='CONFLICT';
  END IF;
  v_revision := v_revision+1;
  UPDATE wjb_v2.workspace SET cursor=cursor+1 WHERE id=p_workspace
    RETURNING cursor INTO v_cursor;
  INSERT INTO wjb_v2.text_record VALUES(p_workspace,p_record,p_body,v_revision)
    ON CONFLICT(workspace_id,id) DO UPDATE SET body=excluded.body,revision=excluded.revision;
  -- Decimal strings avoid bigint precision loss in JSON/JavaScript clients.
  v_result := jsonb_build_object('generation',p_generation::text,'cursor',v_cursor::text,'revision',v_revision::text);
  INSERT INTO wjb_v2.change_log VALUES(p_workspace,v_cursor,p_generation,p_record,v_revision,p_body);
  INSERT INTO wjb_v2.applied_operation VALUES(p_workspace,p_generation,p_device,p_op,v_request,v_result);
  RETURN v_result;
END
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA wjb_v2 FROM PUBLIC, authenticated, anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wjb_v2 FROM PUBLIC, authenticated, anon;
GRANT USAGE ON SCHEMA wjb_v2 TO authenticated;
GRANT SELECT ON wjb_v2.workspace,wjb_v2.text_record,wjb_v2.change_log TO authenticated;
GRANT EXECUTE ON FUNCTION wjb_v2.can_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION wjb_v2.put_text(uuid,bigint,uuid,uuid,uuid,bigint,text) TO authenticated;
COMMIT;
