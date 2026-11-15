-- Unused 010 only: back to the exact 004 command and 007 validation text. Refuses while any upload is staged.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regclass('wjb_migration.upload') IS NULL THEN RAISE EXCEPTION 'MIGRATION_010_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM wjb_migration.upload) OR EXISTS(SELECT 1 FROM wjb_migration.upload_page) THEN RAISE EXCEPTION 'MIGRATION_UPLOAD_ROLLBACK_NOT_EMPTY'; END IF;
 IF EXISTS(SELECT 1 FROM wjb_gateway.asset WHERE bytes>65536) OR EXISTS(SELECT 1 FROM wjb_migration.asset WHERE bytes>65536) THEN RAISE EXCEPTION 'MIGRATION_ASSET_ROLLBACK_NOT_EMPTY'; END IF;
END $$;
ALTER TABLE wjb_gateway.asset DROP CONSTRAINT asset_bytes_check;
ALTER TABLE wjb_gateway.asset ADD CONSTRAINT asset_bytes_check CHECK(bytes BETWEEN 1 AND 65536);
ALTER TABLE wjb_migration.asset DROP CONSTRAINT asset_bytes_check;
ALTER TABLE wjb_migration.asset ADD CONSTRAINT asset_bytes_check CHECK(bytes BETWEEN 1 AND 65536);
ALTER TABLE wjb_gateway.workspace ALTER COLUMN quota_bytes SET DEFAULT 1048576;
DROP FUNCTION public.wjb_v2_device_register(uuid,uuid,uuid);
CREATE OR REPLACE FUNCTION public.wjb_v2_asset_command(p_request jsonb) RETURNS jsonb
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
CREATE OR REPLACE FUNCTION public.wjb_v2_migration_command(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE action text:=p_request->>'action';u uuid:=(p_request->>'userId')::uuid;
 s uuid:=(p_request->>'sessionId')::uuid;dev uuid:=(p_request->>'deviceId')::uuid;
 jid uuid:=(p_request->>'jobId')::uuid;p jsonb:=p_request->'params';j wjb_migration.job;
 norm jsonb;mh text;ws uuid;v jsonb;a wjb_gateway.asset;ma wjb_migration.asset;oid uuid;
 op uuid;ver bigint;settled boolean;
BEGIN
 IF NOT wjb_migration.keys_exact(p_request,ARRAY['action','userId','sessionId','deviceId','jobId','params']) OR
    action NOT IN('start','status','workspace','renew','observe','attest','prepare_publish','publish','publication','cancel','confirm_absent','finish_cancel') OR
    u IS NULL OR s IS NULL OR dev IS NULL OR jid IS NULL OR jsonb_typeof(p)<>'object'
    OR octet_length(p_request::text)>1048576 THEN RAISE EXCEPTION 'MIGRATION_INVALID_REQUEST'; END IF;
 PERFORM 1 FROM wjb_gateway.device WHERE id=dev AND user_id=u AND session_id=s AND NOT revoked FOR SHARE;
 IF NOT FOUND OR NOT public.wjb_v2_session_active(u,s) THEN RAISE EXCEPTION 'MIGRATION_ACCESS_DENIED'; END IF;
 IF action='start' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('migration-start:'||u::text,0));
  norm:=wjb_migration.normalize(p);ws:=(norm->>'workspaceId')::uuid;
  mh:=encode(sha256(convert_to(norm::text,'UTF8')),'hex');
  SELECT * INTO j FROM wjb_migration.job WHERE id=jid;
  IF FOUND THEN
   IF j.owner_id<>u OR j.device_id<>dev OR j.workspace_id<>ws THEN RAISE EXCEPTION 'MIGRATION_ACCESS_DENIED'; END IF;
   IF j.manifest_hash<>mh THEN RAISE EXCEPTION 'MIGRATION_IDEMPOTENCY_MISMATCH'; END IF;
   RETURN jsonb_build_object('jobId',j.id,'state',j.state,'manifestHash',j.manifest_hash,'profile',j.profile,'workspaceId',j.workspace_id,'sourceManifestHash',j.source_manifest_hash);
  END IF;
  IF (SELECT count(*) FROM wjb_migration.job WHERE owner_id=u AND state IN('staging','cancel_fenced'))>=16 THEN RAISE EXCEPTION 'MIGRATION_LIMIT'; END IF;
  INSERT INTO wjb_gateway.workspace(id,owner_id,generation) VALUES(ws,u,1);
  INSERT INTO wjb_migration.job(id,workspace_id,owner_id,device_id,source_manifest_hash,manifest_hash,profile,state)
   VALUES(jid,ws,u,dev,norm->>'sourceManifestHash',mh,norm->>'profile','staging') RETURNING * INTO j;
  FOR v IN SELECT value FROM jsonb_array_elements(norm->'assets') LOOP
   INSERT INTO wjb_migration.asset(job_id,workspace_id,object_id,sha256,bytes) VALUES(jid,ws,(v->>'objectId')::uuid,v->>'sha256',(v->>'bytes')::integer);
   PERFORM public.wjb_v2_asset_command(jsonb_build_object('action','reserve','userId',u,'sessionId',s,
    'scope',jsonb_build_object('workspaceId',ws,'assetId',v->>'objectId','deviceId',dev,'generation','1'),
    'params',jsonb_build_object('sha256',v->>'sha256','bytes',(v->>'bytes')::integer)));
  END LOOP;
  FOR v IN SELECT value FROM jsonb_array_elements(coalesce(norm->'documents','[]'::jsonb)) LOOP
   INSERT INTO wjb_migration.document VALUES(jid,(v->>'id')::uuid,v->>'title',v->'blocks');
  END LOOP;
  IF norm->>'profile'<>'migration-document-poc-1' THEN
   INSERT INTO wjb_migration.workspace_header VALUES(jid,norm-'records'-'assets');
   FOR v IN SELECT value FROM jsonb_array_elements(norm->'records') LOOP
    INSERT INTO wjb_migration.workspace_record VALUES(jid,v->>'table',v->>'key',v->'value');
   END LOOP;
  END IF;
  RETURN jsonb_build_object('jobId',jid,'state','staging','manifestHash',mh,'profile',j.profile,'workspaceId',j.workspace_id,'sourceManifestHash',j.source_manifest_hash);
 END IF;
 IF NOT wjb_migration.keys_exact(p,CASE action
   WHEN 'workspace' THEN ARRAY['manifestHash']
   WHEN 'status' THEN ARRAY['manifestHash']
   WHEN 'renew' THEN ARRAY['manifestHash','objectId']
   WHEN 'observe' THEN ARRAY['manifestHash','objectId']
   WHEN 'attest' THEN ARRAY['manifestHash','objectId','ioVersion','sha256','bytes']
   WHEN 'prepare_publish' THEN ARRAY['manifestHash','operationId','expectedFence']
   WHEN 'publish' THEN ARRAY['manifestHash','operationId','token','fence']
   WHEN 'publication' THEN ARRAY['manifestHash','operationId']
   WHEN 'cancel' THEN ARRAY['manifestHash','operationId']
   WHEN 'confirm_absent' THEN ARRAY['manifestHash','objectId','ioVersion']
   WHEN 'finish_cancel' THEN ARRAY['manifestHash'] ELSE ARRAY[]::text[] END)
   THEN RAISE EXCEPTION 'MIGRATION_INVALID_PARAMS'; END IF;
 SELECT workspace_id INTO ws FROM wjb_migration.job WHERE id=jid AND owner_id=u AND device_id=dev;
 IF NOT FOUND THEN RAISE EXCEPTION 'MIGRATION_ACCESS_DENIED'; END IF;
 -- Same lock order as C2: device -> workspace -> job -> assets (sorted).
 PERFORM 1 FROM wjb_gateway.workspace WHERE id=ws AND owner_id=u FOR UPDATE;
 SELECT * INTO j FROM wjb_migration.job WHERE id=jid FOR UPDATE;
 IF p->>'manifestHash' IS DISTINCT FROM j.manifest_hash THEN RAISE EXCEPTION 'MIGRATION_MANIFEST_CHANGED'; END IF;
 PERFORM 1 FROM wjb_gateway.asset WHERE workspace_id=ws ORDER BY id FOR UPDATE;
 IF action='status' THEN RETURN jsonb_build_object('jobId',jid,'state',j.state,'epoch',j.epoch::text,
   'manifestHash',j.manifest_hash,'profile',j.profile,'workspaceId',j.workspace_id,'sourceManifestHash',j.source_manifest_hash); END IF;
 IF action='workspace' THEN
  IF j.profile='migration-document-poc-1' OR j.state NOT IN('staging','connected') THEN RAISE EXCEPTION 'MIGRATION_WORKSPACE_UNAVAILABLE'; END IF;
  norm:=wjb_migration.current_manifest(jid);
  IF norm IS NULL OR encode(sha256(convert_to(norm::text,'UTF8')),'hex')<>j.manifest_hash THEN RAISE EXCEPTION 'MIGRATION_METADATA_CHANGED'; END IF;
  PERFORM wjb_migration.normalize_workspace(norm);
  RETURN jsonb_build_object('jobId',jid,'workspaceId',ws,'manifestHash',j.manifest_hash,'envelope',norm,'productActivationAllowed',false);
 END IF;
 IF action='cancel' THEN
  op:=(p->>'operationId')::uuid;IF op IS NULL THEN RAISE EXCEPTION 'MIGRATION_OPERATION_REQUIRED'; END IF;
  IF j.state='connected' THEN RETURN jsonb_build_object('state','connected','receipt',wjb_migration.receipt(j)); END IF;
  IF j.state IN('cancel_fenced','canceled') THEN
   IF j.cancel_op<>op THEN RAISE EXCEPTION 'MIGRATION_OPERATION_CHANGED'; END IF;
  ELSE
   UPDATE wjb_migration.job SET state='cancel_fenced',epoch=epoch+1,cancel_op=op,
     publish_fence=publish_fence+1,publish_token=NULL,publish_expires=NULL WHERE id=jid RETURNING * INTO j;
   UPDATE wjb_gateway.asset SET state='cleanup',io_version=io_version+1 WHERE workspace_id=ws AND state<>'canceled';
  END IF;
  RETURN jsonb_build_object('state','cancel_fenced','jobId',jid,'manifestHash',j.manifest_hash,'epoch',j.epoch::text,'publishBlocked',true);
 END IF;
 IF action IN('prepare_publish','publish','publication') THEN
  op:=(p->>'operationId')::uuid;IF op IS NULL THEN RAISE EXCEPTION 'MIGRATION_OPERATION_REQUIRED'; END IF;
  IF j.state='connected' THEN
   IF j.publish_op<>op THEN RAISE EXCEPTION 'MIGRATION_OPERATION_CHANGED'; END IF;
   RETURN jsonb_build_object('state','connected','jobId',jid,'operationId',op,'manifestHash',j.manifest_hash,'receipt',wjb_migration.receipt(j));
  END IF;
  IF j.state<>'staging' THEN RAISE EXCEPTION 'MIGRATION_CANCELED'; END IF;
  IF j.publish_op IS NOT NULL AND j.publish_op<>op THEN RAISE EXCEPTION 'MIGRATION_OPERATION_CHANGED'; END IF;
  IF action='publication' THEN
   IF j.publish_token IS NOT NULL AND j.publish_expires>clock_timestamp() THEN
    RETURN jsonb_build_object('state','pending','operationSettled',false,'jobId',jid,'operationId',op,'manifestHash',j.manifest_hash);
   END IF;
   -- Invalidate expired/missing attempts, including late prepare requests.
   UPDATE wjb_migration.job SET publish_op=op,publish_fence=publish_fence+1,publish_token=NULL,publish_expires=NULL WHERE id=jid RETURNING * INTO j;
   RETURN jsonb_build_object('state','absent','operationSettled',true,'serverFence',j.publish_fence::text,'jobId',jid,'operationId',op,'manifestHash',j.manifest_hash);
  END IF;
  IF action='prepare_publish' THEN
   IF (p->>'expectedFence')::bigint IS DISTINCT FROM j.publish_fence THEN RAISE EXCEPTION 'MIGRATION_PUBLISH_FENCED'; END IF;
   IF j.publish_token IS NOT NULL AND j.publish_expires>clock_timestamp() THEN RAISE EXCEPTION 'MIGRATION_PUBLISH_BUSY'; END IF;
   UPDATE wjb_migration.job SET publish_op=op,publish_fence=publish_fence+1,publish_token=gen_random_uuid(),publish_expires=clock_timestamp()+interval '30 seconds' WHERE id=jid RETURNING * INTO j;
   RETURN jsonb_build_object('operationId',op,'token',j.publish_token,'fence',j.publish_fence::text);
  END IF;
  IF (p->>'token')::uuid IS DISTINCT FROM j.publish_token OR j.publish_token IS NULL OR
     (p->>'fence')::bigint IS DISTINCT FROM j.publish_fence OR j.publish_expires<=clock_timestamp() THEN RAISE EXCEPTION 'MIGRATION_PUBLISH_FENCED'; END IF;
  IF encode(sha256(convert_to(wjb_migration.current_manifest(jid)::text,'UTF8')),'hex') IS DISTINCT FROM j.manifest_hash THEN RAISE EXCEPTION 'MIGRATION_METADATA_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM wjb_migration.asset m JOIN wjb_gateway.asset x ON x.workspace_id=m.workspace_id AND x.id=m.object_id
    WHERE m.job_id=jid AND (x.state<>'ready' OR x.sha256<>m.sha256 OR x.bytes<>m.bytes OR
      m.verified_version IS DISTINCT FROM x.io_version OR m.verified_at IS NULL OR m.verified_at<clock_timestamp()-interval '60 seconds' OR
      x.lease_expires>clock_timestamp())) OR
    EXISTS(SELECT 1 FROM wjb_gateway.io_intent pending_io WHERE pending_io.workspace_id=ws AND NOT pending_io.settled)
    THEN RAISE EXCEPTION 'MIGRATION_NOT_VERIFIED'; END IF;
  IF j.publish_expires<=clock_timestamp() THEN RAISE EXCEPTION 'MIGRATION_PUBLISH_FENCED'; END IF;
  UPDATE wjb_migration.job SET state='connected',publish_op=op,publish_token=NULL,publish_expires=NULL WHERE id=jid RETURNING * INTO j;
  RETURN wjb_migration.receipt(j);
 END IF;
 IF action='finish_cancel' THEN
  IF j.state NOT IN('cancel_fenced','canceled') THEN RAISE EXCEPTION 'MIGRATION_CANCEL_NOT_FENCED'; END IF;
  IF EXISTS(SELECT 1 FROM wjb_migration.asset m JOIN wjb_gateway.asset x ON x.workspace_id=m.workspace_id AND x.id=m.object_id
    WHERE m.job_id=jid AND (x.state<>'canceled' OR m.absent_version IS DISTINCT FROM x.io_version OR x.lease_expires>clock_timestamp())) OR
    EXISTS(SELECT 1 FROM wjb_gateway.io_intent pending_io WHERE pending_io.workspace_id=ws AND NOT pending_io.settled) THEN RAISE EXCEPTION 'MIGRATION_CANCEL_INCOMPLETE'; END IF;
  UPDATE wjb_migration.job SET state='canceled' WHERE id=jid;
  RETURN jsonb_build_object('state','canceled','jobId',jid,'manifestHash',j.manifest_hash,'epoch',j.epoch::text);
 END IF;
 oid:=(p->>'objectId')::uuid;
 SELECT * INTO ma FROM wjb_migration.asset WHERE job_id=jid AND object_id=oid;
 IF NOT FOUND THEN RAISE EXCEPTION 'MIGRATION_ASSET_NOT_DECLARED'; END IF;
 SELECT * INTO a FROM wjb_gateway.asset WHERE workspace_id=ws AND id=oid;
 settled:=NOT EXISTS(SELECT 1 FROM wjb_gateway.io_intent pending_io WHERE pending_io.workspace_id=ws AND pending_io.asset_id=oid AND NOT pending_io.settled)
   AND (a.lease_expires IS NULL OR a.lease_expires<=clock_timestamp());
 IF action='observe' THEN RETURN jsonb_build_object('jobId',jid,'objectId',oid,'manifestHash',j.manifest_hash,
   'assetState',a.state,'ioVersion',a.io_version::text,'operationSettled',settled,'sha256',a.sha256,'bytes',a.bytes,'ownedByJob',true);
 END IF;
 IF action='renew' THEN
  IF j.state<>'staging' OR a.state<>'reserved' OR NOT settled THEN RAISE EXCEPTION 'MIGRATION_RENEW_BLOCKED'; END IF;
  UPDATE wjb_gateway.asset SET expires_at=clock_timestamp()+interval '5 minutes' WHERE workspace_id=ws AND id=oid;
  RETURN jsonb_build_object('renewed',true);
 END IF;
 ver:=(p->>'ioVersion')::bigint;
 IF ver IS NULL OR ver<>a.io_version OR NOT settled THEN RAISE EXCEPTION 'MIGRATION_IO_UNSETTLED'; END IF;
 IF action='attest' THEN
  IF j.state<>'staging' OR a.state<>'ready' OR p->>'sha256' IS DISTINCT FROM ma.sha256 OR
     (p->>'bytes')::integer IS DISTINCT FROM ma.bytes THEN RAISE EXCEPTION 'MIGRATION_ATTESTATION_REJECTED'; END IF;
  -- Server gateway only: must hash/read back actual private bytes before calling.
  UPDATE wjb_migration.asset SET verified_version=ver,verified_at=clock_timestamp() WHERE job_id=jid AND object_id=oid;
  RETURN jsonb_build_object('attested',true,'ioVersion',ver::text);
 END IF;
 IF action='confirm_absent' THEN
  IF j.state='canceled' AND a.state='canceled' AND ma.absent_version=ver THEN
   RETURN jsonb_build_object('absentConfirmed',true);
  END IF;
  IF j.state<>'cancel_fenced' OR a.state NOT IN('cleanup','canceled') THEN RAISE EXCEPTION 'MIGRATION_CANCEL_NOT_FENCED'; END IF;
  -- Server gateway only: requires actual absence after DELETE and settled I/O.
  IF a.state<>'canceled' THEN
   UPDATE wjb_gateway.asset SET state='canceled' WHERE workspace_id=ws AND id=oid;
   UPDATE wjb_gateway.workspace SET used_bytes=used_bytes-a.bytes WHERE id=ws;
  END IF;
  UPDATE wjb_migration.asset SET absent_version=ver WHERE job_id=jid AND object_id=oid;
  RETURN jsonb_build_object('absentConfirmed',true);
 END IF;
 RAISE EXCEPTION 'MIGRATION_INVALID_ACTION';
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'MIGRATION_INVALID_REQUEST';
END $$;
CREATE OR REPLACE FUNCTION wjb_migration.normalize_workspace(v jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE contract jsonb;r jsonb;rowv jsonb;c jsonb;col text;t text;pk jsonb;k text;fk jsonb;ref jsonb;a jsonb;st jsonb;d jsonb;n jsonb;setting jsonb;names text[];total integer;version integer;
BEGIN
 IF NOT coalesce(wjb_migration.keys_exact(v,ARRAY['profile','workspaceId','sourceSchema','contractFingerprint','sourceManifestHash','assets','records','tableStats','exclusions','policies']),false) THEN RAISE EXCEPTION 'MIGRATION_WORKSPACE_FORMAT'; END IF;
 IF jsonb_typeof(v->'sourceSchema') IS DISTINCT FROM 'number' OR (v->>'sourceSchema') NOT IN('18','19','20') THEN RAISE EXCEPTION 'MIGRATION_WORKSPACE_SCHEMA'; END IF;
 IF v->>'workspaceId' IS DISTINCT FROM ((v->>'workspaceId')::uuid)::text THEN RAISE EXCEPTION 'MIGRATION_WORKSPACE_FORMAT'; END IF;
 version:=(v->>'sourceSchema')::integer;contract:=wjb_migration.workspace_contract(version);
 IF v->>'profile' IS DISTINCT FROM 'workspace-db'||version||'-map-poc-1' OR v->>'contractFingerprint' IS DISTINCT FROM contract->>'fingerprint' OR coalesce(v->>'sourceManifestHash','') !~ '^[0-9a-f]{64}$' OR (v->>'workspaceId')::uuid IS NULL THEN RAISE EXCEPTION 'MIGRATION_WORKSPACE_SCHEMA'; END IF;
 IF octet_length(v::text)>1048576 OR jsonb_typeof(v->'records') IS DISTINCT FROM 'array' OR jsonb_typeof(v->'assets') IS DISTINCT FROM 'array' OR jsonb_typeof(v->'exclusions') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'MIGRATION_LIMIT'; END IF;
 IF jsonb_array_length(v->'records')>2048 OR jsonb_array_length(v->'assets')>8 OR jsonb_array_length(v->'exclusions')>4096 THEN RAISE EXCEPTION 'MIGRATION_LIMIT'; END IF;
 IF v->'policies' IS DISTINCT FROM '{"folderTargets":"device-local-unbound","sourceModel":"permanent-local-unchanged","imageBodies":"private-blob-only"}'::jsonb OR NOT wjb_migration.keys_exact(v->'tableStats',ARRAY(SELECT jsonb_object_keys(contract->'tables'))) THEN RAISE EXCEPTION 'MIGRATION_WORKSPACE_FORMAT'; END IF;
 PERFORM wjb_migration.image_free(v);
 FOR a IN SELECT value FROM jsonb_array_elements(v->'assets') LOOP
  IF a->>'objectId' IS DISTINCT FROM ((a->>'objectId')::uuid)::text THEN RAISE EXCEPTION 'MIGRATION_INVALID_ASSET'; END IF;
  IF NOT wjb_migration.keys_exact(a,ARRAY['objectId','sha256','bytes']) OR (a->>'objectId')::uuid IS NULL OR coalesce(a->>'sha256','') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(a->'bytes') IS DISTINCT FROM 'number' OR (a->>'bytes') !~ '^[1-9][0-9]*$' OR (a->>'bytes')::bigint NOT BETWEEN 1 AND 65536 THEN RAISE EXCEPTION 'MIGRATION_INVALID_ASSET'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'assets') x GROUP BY (x->>'objectId')::uuid HAVING count(*)>1) THEN RAISE EXCEPTION 'MIGRATION_DUPLICATE_ASSET'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(v->'records') LOOP
  IF NOT wjb_migration.keys_exact(r,ARRAY['table','key','value']) OR NOT (contract->'tables' ? (r->>'table')) OR jsonb_typeof(r->'value') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'MIGRATION_ROW_FORMAT'; END IF;
  t:=r->>'table';rowv:=r->'value';names:='{}';pk:='[]';
  FOR c IN SELECT value FROM jsonb_array_elements(contract->'tables'->t->'columns') LOOP
   col:=c->>'name';
   IF t IN('note_asset','cabi_asset') AND col IN('data','thumb') THEN
    names:=array_append(names,col||'Ref');ref:=rowv->(col||'Ref');
    IF ref IS NULL OR (col='data' AND ref='null'::jsonb) THEN RAISE EXCEPTION 'MIGRATION_IMAGE_REFERENCE'; END IF;
    IF ref<>'null'::jsonb AND (NOT wjb_migration.keys_exact(ref,ARRAY['objectId','sha256','bytes']) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'assets') x WHERE x=ref) OR (col='data' AND ref->'bytes' IS DISTINCT FROM rowv->'bytes')) THEN RAISE EXCEPTION 'MIGRATION_IMAGE_REFERENCE'; END IF;
    CONTINUE;
   END IF;
   names:=array_append(names,col);
   IF NOT (rowv ? col) THEN RAISE EXCEPTION 'MIGRATION_ROW_COLUMNS'; END IF;
   IF rowv->col='null'::jsonb THEN
    IF ((c->>'nullable')::boolean=false OR (c->>'pk')::integer>0) AND NOT(t='cabinet_item' AND col='target' AND rowv->>'kind'='folder') THEN RAISE EXCEPTION 'MIGRATION_ROW_TYPE'; END IF;
   ELSIF (c->>'type'='TEXT' AND jsonb_typeof(rowv->col)<>'string') OR (c->>'type'='INTEGER' AND (jsonb_typeof(rowv->col)<>'number' OR (rowv->>col) !~ '^-?[0-9]+$' OR abs((rowv->>col)::numeric)>9007199254740991)) THEN RAISE EXCEPTION 'MIGRATION_ROW_TYPE'; END IF;
  END LOOP;
  IF t='cabinet_item' AND rowv->>'kind'='folder' THEN
   names:=array_append(names,'targetState');
   IF rowv->'target' IS DISTINCT FROM 'null'::jsonb OR rowv->>'targetState' IS DISTINCT FROM 'device-local-unbound' THEN RAISE EXCEPTION 'MIGRATION_LOCAL_PATH'; END IF;
  ELSIF t='cabinet_item' AND (coalesce(rowv->>'kind','')<>'link' OR coalesce(rowv->>'target','') !~* '^https?://') THEN RAISE EXCEPTION 'MIGRATION_LOCAL_PATH'; END IF;
  IF NOT wjb_migration.keys_exact(rowv,names) THEN RAISE EXCEPTION 'MIGRATION_ROW_COLUMNS'; END IF;
  SELECT coalesce(jsonb_agg(rowv->(x->>'name') ORDER BY (x->>'pk')::integer),'[]') INTO pk FROM jsonb_array_elements(contract->'tables'->t->'columns') x WHERE (x->>'pk')::integer>0;
  k:=encode(sha256(convert_to(wjb_migration.canonical(jsonb_build_array(t,pk)),'UTF8')),'hex');
  IF r->>'key' IS DISTINCT FROM k THEN RAISE EXCEPTION 'MIGRATION_RECORD_KEY'; END IF;
  FOR fk IN SELECT value FROM jsonb_array_elements(contract->'tables'->t->'foreignKeys') LOOP
   IF rowv->(fk->>'from')<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'records') other WHERE other->>'table'=fk->>'table' AND other->'value'->(fk->>'to')=rowv->(fk->>'from')) THEN RAISE EXCEPTION 'MIGRATION_FOREIGN_KEY'; END IF;
  END LOOP;
  IF t='cabi_note' THEN
   IF version>=19 AND rowv->'delete_locked' NOT IN('0'::jsonb,'1'::jsonb) THEN RAISE EXCEPTION 'MIGRATION_DELETE_LOCK'; END IF;
   PERFORM wjb_migration.rich_valid((rowv->>'content')::jsonb,rowv->>'id',v->'records');
  ELSIF t IN('week_note','cabi_board') THEN PERFORM wjb_migration.board_valid((rowv->>'doc')::jsonb,CASE WHEN t='week_note' THEN rowv->>'week_id' ELSE rowv->>'id' END,t='week_note',v->'records');
  ELSIF t='import_batch' THEN
   IF rowv->>'file_name' ~ '[/\\]' THEN RAISE EXCEPTION 'MIGRATION_LOCAL_PATH'; END IF;
   d:=(rowv->>'undo_json')::jsonb;
   IF jsonb_typeof(d)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(d) x WHERE x NOT IN('relations','deletedItems','notes','createdCategories','periodStarts','reopened')) THEN RAISE EXCEPTION 'MIGRATION_UNDO_FORMAT'; END IF;
   FOREACH col IN ARRAY ARRAY['deletedItems','notes','createdCategories','periodStarts','reopened'] LOOP
    IF jsonb_typeof(d->col) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'MIGRATION_UNDO_FORMAT'; END IF;
   END LOOP;
   FOR n IN SELECT value FROM jsonb_array_elements(d->'notes') LOOP
    IF n->'doc'<>'null'::jsonb THEN PERFORM wjb_migration.board_valid((n->>'doc')::jsonb,n->>'weekId',true,v->'records'); END IF;
   END LOOP;
  ELSIF t='knowledge_card_source' THEN
   d:=(rowv->>'locator_json')::jsonb;
   IF jsonb_typeof(d)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(d) x WHERE x<>'label') THEN RAISE EXCEPTION 'MIGRATION_LOCAL_PATH'; END IF;
  ELSIF t='kanban_ctx' THEN RAISE EXCEPTION 'MIGRATION_KANBAN_CONTEXT';
  ELSIF t='kanban_section' THEN
   IF char_length(rowv->>'name') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'MIGRATION_KANBAN_FORMAT'; END IF;
  ELSIF t='item_status_log' THEN
   IF rowv->>'source' NOT IN('kanban','board','important','bulk','section','import','migrate') OR rowv->>'changed_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,3})?Z$' OR char_length(rowv->>'from_key') NOT BETWEEN 1 AND 64 OR char_length(rowv->>'to_key') NOT BETWEEN 1 AND 64 OR rowv->>'from_key'=rowv->>'to_key' THEN RAISE EXCEPTION 'MIGRATION_KANBAN_FORMAT'; END IF;
  ELSIF t='kanban_bulk' THEN
   BEGIN d:=(rowv->>'items')::jsonb; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'MIGRATION_KANBAN_FORMAT'; END;
   IF jsonb_typeof(d) IS DISTINCT FROM 'array' OR jsonb_array_length(d)<(rowv->>'count')::bigint OR EXISTS(SELECT 1 FROM jsonb_array_elements(d) p WHERE jsonb_typeof(p)<>'array' OR jsonb_array_length(p)<>2 OR jsonb_typeof(p->0)<>'string' OR jsonb_typeof(p->1)<>'string' OR (p->>1) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,3})?Z$') OR (rowv->'undone_at'<>'null'::jsonb AND rowv->>'undone_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,3})?Z$') THEN RAISE EXCEPTION 'MIGRATION_KANBAN_FORMAT'; END IF;
  ELSIF t='app_meta' THEN
   IF rowv->>'key'='settings' THEN
    setting:=(rowv->>'value')::jsonb;
    IF jsonb_typeof(setting)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(setting) x WHERE x NOT IN('workspace','nudgeWeeks','summary','holiday') AND NOT(version>=20 AND x='ui')) THEN RAISE EXCEPTION 'MIGRATION_SETTINGS'; END IF;
    IF setting ? 'workspace' AND setting->'workspace'<>'null'::jsonb THEN
     IF NOT wjb_migration.keys_exact(setting->'workspace',ARRAY['name','color','icon','updatedAt']) OR jsonb_typeof(setting->'workspace'->'updatedAt') IS DISTINCT FROM 'number' OR (setting->'workspace'->>'updatedAt') !~ '^-?[0-9]+$' THEN RAISE EXCEPTION 'MIGRATION_SETTINGS'; END IF;
     FOREACH col IN ARRAY ARRAY['name','color','icon'] LOOP
      IF jsonb_typeof(setting->'workspace'->col) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'MIGRATION_SETTINGS'; END IF;
     END LOOP;
    END IF;
    IF setting ? 'nudgeWeeks' AND (jsonb_typeof(setting->'nudgeWeeks') IS DISTINCT FROM 'number' OR (setting->>'nudgeWeeks') !~ '^-?[0-9]+$') THEN RAISE EXCEPTION 'MIGRATION_SETTINGS'; END IF;
    IF setting ? 'summary' AND (NOT wjb_migration.keys_exact(setting->'summary',ARRAY['includeMemo']) OR jsonb_typeof(setting->'summary'->'includeMemo') IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'MIGRATION_SETTINGS'; END IF;
    IF setting ? 'holiday' THEN
     IF NOT wjb_migration.keys_exact(setting->'holiday',ARRAY['krEnabled','off','company','reasons']) OR jsonb_typeof(setting->'holiday'->'krEnabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'MIGRATION_SETTINGS'; END IF;
     FOREACH col IN ARRAY ARRAY['off','company','reasons'] LOOP
      IF jsonb_typeof(setting->'holiday'->col) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'MIGRATION_SETTINGS'; END IF;
     END LOOP;
     IF EXISTS(SELECT 1 FROM jsonb_array_elements((setting->'holiday'->'off')||(setting->'holiday'->'reasons')) x WHERE jsonb_typeof(x)<>'string') THEN RAISE EXCEPTION 'MIGRATION_SETTINGS'; END IF;
     FOR n IN SELECT value FROM jsonb_array_elements(setting->'holiday'->'company') LOOP
      IF NOT wjb_migration.keys_exact(n,ARRAY['date','name']) OR jsonb_typeof(n->'date') IS DISTINCT FROM 'string' OR jsonb_typeof(n->'name') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'MIGRATION_SETTINGS'; END IF;
     END LOOP;
    END IF;
    IF setting ? 'ui' THEN
     -- DB20: only column order/icons (workspace content naming sections). Layout and other ui stay per device.
     n:=setting->'ui'->'kanbanColumns';
     IF NOT wjb_migration.keys_exact(setting->'ui',ARRAY['kanbanColumns']) OR NOT coalesce(wjb_migration.keys_exact(n,ARRAY['order','icons']),false) OR jsonb_typeof(n->'order') IS DISTINCT FROM 'array' OR jsonb_typeof(n->'icons') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'MIGRATION_SETTINGS'; END IF;
     IF EXISTS(SELECT 1 FROM jsonb_array_elements(n->'order') x WHERE jsonb_typeof(x)<>'string' OR NOT ((x#>>'{}') IN('todo','done') OR EXISTS(SELECT 1 FROM jsonb_array_elements(v->'records') s WHERE s->>'table'='kanban_section' AND s->'value'->>'id'=x#>>'{}'))) OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(n->'order') x)<>jsonb_array_length(n->'order') THEN RAISE EXCEPTION 'MIGRATION_KANBAN_REFERENCE'; END IF;
     IF EXISTS(SELECT 1 FROM jsonb_each(n->'icons') e WHERE jsonb_typeof(e.value)<>'string' OR NOT (e.value#>>'{}')=ANY(ARRAY['alarm-clock','bar-chart','bell','bookmark-tabs','brain','bullseye','card-index-dividers','chart-increasing','check-mark-button','chequered-flag','clipboard','compass','construction','eyes','file-folder','fire','gear','hammer-and-wrench','handshake','hourglass-not-done','inbox-tray','label','light-bulb','locked','magnifying-glass-tilted-left','megaphone','memo','package','pause-button','pushpin','rocket','speech-balloon','spiral-calendar','star','stopwatch','test-tube']) OR NOT (e.key IN('todo','done') OR EXISTS(SELECT 1 FROM jsonb_array_elements(v->'records') s WHERE s->>'table'='kanban_section' AND s->'value'->>'id'=e.key))) THEN RAISE EXCEPTION 'MIGRATION_KANBAN_REFERENCE'; END IF;
    END IF;
   ELSIF rowv->>'key'<>'created_at' THEN RAISE EXCEPTION 'MIGRATION_SETTINGS'; END IF;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'records') x GROUP BY x->>'table',x->>'key' HAVING count(*)>1) THEN RAISE EXCEPTION 'MIGRATION_DUPLICATE_RECORD'; END IF;
 FOR t IN SELECT jsonb_object_keys(contract->'tables') LOOP
  st:=v->'tableStats'->t;
  IF NOT wjb_migration.keys_exact(st,ARRAY['sourceRows','mappedRows','excludedRows','transformedRows']) THEN RAISE EXCEPTION 'MIGRATION_ROW_COUNTS'; END IF;
  FOREACH col IN ARRAY ARRAY['sourceRows','mappedRows','excludedRows','transformedRows'] LOOP
   IF jsonb_typeof(st->col) IS DISTINCT FROM 'number' OR (st->>col) !~ '^[0-9]+$' OR (st->>col)::bigint>4096 THEN RAISE EXCEPTION 'MIGRATION_ROW_COUNTS'; END IF;
  END LOOP;
  SELECT count(*) INTO total FROM jsonb_array_elements(v->'records') x WHERE x->>'table'=t;
  IF (st->>'mappedRows')::integer<>total OR (st->>'sourceRows')::integer<>total+(st->>'excludedRows')::integer OR (st->>'transformedRows')::integer>total OR (st->>'excludedRows')::integer<>(CASE WHEN t='app_meta' OR (version>=20 AND t='kanban_ctx') THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'MIGRATION_ROW_COUNTS'; END IF;
 END LOOP;
 FOR d IN SELECT value FROM jsonb_array_elements(v->'exclusions') LOOP
  IF NOT coalesce(wjb_migration.keys_exact(d,ARRAY['table','key','reason']) OR wjb_migration.keys_exact(d,ARRAY['table','key','reason','field']) OR (version>=20 AND wjb_migration.keys_exact(d,ARRAY['table','key','reason','kept']) AND d->>'key'='settings.ui' AND d->'kept'='["kanbanColumns"]'::jsonb),false) THEN RAISE EXCEPTION 'MIGRATION_EXCLUSION'; END IF;
  IF NOT ((d->>'table'='app_meta' AND d->>'key'='schema_version' AND d->>'reason'='source-format-only') OR (d->>'table'='app_meta' AND d->>'key' IN('settings.ui','settings.ai','settings.backup') AND d->>'reason'='device-preference-not-synced') OR (d->>'table'='cabinet_item' AND d->>'field'='target' AND d->>'reason'='device-filesystem-path') OR (d->>'table'='import_batch' AND d->>'field'='file_name' AND d->>'reason'='path-basename-only') OR (version>=20 AND d->>'table'='kanban_ctx' AND d->>'key'='1' AND d->>'reason'='local-write-context')) THEN RAISE EXCEPTION 'MIGRATION_EXCLUSION'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(v->'exclusions') x WHERE x->>'table'='app_meta' AND x->>'key'='schema_version' AND x->>'reason'='source-format-only')<>1 THEN RAISE EXCEPTION 'MIGRATION_EXCLUSION'; END IF;
  IF version>=20 AND (SELECT count(*) FROM jsonb_array_elements(v->'exclusions') x WHERE x->>'table'='kanban_ctx')<>1 THEN RAISE EXCEPTION 'MIGRATION_EXCLUSION'; END IF;
 RETURN v||jsonb_build_object('records',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'table' COLLATE "C",x->>'key'),'[]') FROM jsonb_array_elements(v->'records') x),'assets',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'objectId'),'[]') FROM jsonb_array_elements(v->'assets') x));
END $$;
DROP FUNCTION wjb_migration.command_core(jsonb);
DROP TABLE wjb_migration.upload_page;
DROP TABLE wjb_migration.upload;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wjb_migration FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
