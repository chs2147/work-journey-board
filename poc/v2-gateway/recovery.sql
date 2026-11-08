-- LOCAL / REVIEW CANDIDATE. Requires the matching metadata schema and C1.
BEGIN;
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
COMMIT;
