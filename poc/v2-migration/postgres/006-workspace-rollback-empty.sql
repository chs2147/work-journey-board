-- Empty full-profile extension only; preserve document jobs and all C1/C2 data.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM wjb_migration.job WHERE profile<>'migration-document-poc-1') OR EXISTS(SELECT 1 FROM wjb_migration.workspace_header) OR EXISTS(SELECT 1 FROM wjb_migration.workspace_record) THEN RAISE EXCEPTION 'MIGRATION_WORKSPACE_ROLLBACK_NOT_EMPTY'; END IF;
END $$;
CREATE OR REPLACE FUNCTION wjb_migration.keys_exact(v jsonb,wanted text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(v)='object' AND
 (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) k)=(SELECT array_agg(k ORDER BY k) FROM unnest(wanted) k)
$$;
CREATE OR REPLACE FUNCTION wjb_migration.normalize(v jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE a jsonb;d jsonb;b jsonb;ids uuid[]:='{}';docs uuid[]:='{}';object_id uuid;
 aa jsonb:='[]';dd jsonb:='[]';bb jsonb;
BEGIN
 IF NOT wjb_migration.keys_exact(v,ARRAY['workspaceId','sourceManifestHash','assets','documents']) OR
    jsonb_typeof(v->'assets')<>'array' OR jsonb_typeof(v->'documents')<>'array' OR
    (v->>'sourceManifestHash') !~ '^[0-9a-f]{64}$' OR
    octet_length(v::text)>65536 THEN RAISE EXCEPTION 'MIGRATION_INVALID_MANIFEST'; END IF;
 PERFORM (v->>'workspaceId')::uuid;
 IF jsonb_array_length(v->'assets')>8 OR jsonb_array_length(v->'documents')>16 THEN RAISE EXCEPTION 'MIGRATION_LIMIT'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(v->'assets') LOOP
  IF NOT wjb_migration.keys_exact(a,ARRAY['objectId','sha256','bytes']) OR
     jsonb_typeof(a->'bytes')<>'number' OR (a->>'bytes') !~ '^[1-9][0-9]*$' OR
     (a->>'bytes')::integer NOT BETWEEN 1 AND 65536 OR (a->>'sha256') !~ '^[0-9a-f]{64}$'
     THEN RAISE EXCEPTION 'MIGRATION_INVALID_ASSET'; END IF;
  object_id:=(a->>'objectId')::uuid;
  IF object_id IS NULL OR object_id=ANY(ids) THEN RAISE EXCEPTION 'MIGRATION_DUPLICATE_ASSET'; END IF;
  ids:=array_append(ids,object_id);
  aa:=aa||jsonb_build_array(jsonb_build_object('objectId',object_id,'sha256',a->>'sha256','bytes',(a->>'bytes')::integer));
 END LOOP;
 FOR d IN SELECT value FROM jsonb_array_elements(v->'documents') LOOP
  IF NOT wjb_migration.keys_exact(d,ARRAY['id','title','blocks']) OR
     jsonb_typeof(d->'title')<>'string' OR length(d->>'title')>200 OR
     jsonb_typeof(d->'blocks')<>'array' OR jsonb_array_length(d->'blocks')>64 THEN RAISE EXCEPTION 'MIGRATION_DOCUMENT_FORMAT'; END IF;
  object_id:=(d->>'id')::uuid;
  IF object_id IS NULL OR object_id=ANY(docs) THEN RAISE EXCEPTION 'MIGRATION_DUPLICATE_DOCUMENT'; END IF;
  docs:=array_append(docs,object_id);
  bb:='[]';
  FOR b IN SELECT value FROM jsonb_array_elements(d->'blocks') LOOP
   IF b->>'type'='paragraph' THEN
    IF NOT wjb_migration.keys_exact(b,ARRAY['type','text']) OR jsonb_typeof(b->'text')<>'string' OR
       octet_length(b->>'text')>4096 THEN RAISE EXCEPTION 'MIGRATION_DOCUMENT_FORMAT'; END IF;
    bb:=bb||jsonb_build_array(jsonb_build_object('type','paragraph','text',b->>'text'));
   ELSIF b->>'type'='image' THEN
    IF NOT wjb_migration.keys_exact(b,ARRAY['type','assetId','alt']) OR jsonb_typeof(b->'alt')<>'string' OR
       length(b->>'alt')>200 THEN RAISE EXCEPTION 'MIGRATION_DOCUMENT_FORMAT'; END IF;
    IF (b->>'assetId')::uuid IS NULL OR NOT ((b->>'assetId')::uuid=ANY(ids)) THEN RAISE EXCEPTION 'MIGRATION_IMAGE_REFERENCE'; END IF;
    bb:=bb||jsonb_build_array(jsonb_build_object('type','image','assetId',(b->>'assetId')::uuid,'alt',b->>'alt'));
   ELSE RAISE EXCEPTION 'MIGRATION_DOCUMENT_FORMAT'; END IF;
  END LOOP;
  dd:=dd||jsonb_build_array(jsonb_build_object('id',object_id,'title',d->>'title','blocks',bb));
 END LOOP;
 -- Image nodes have UUID refs only; no generic attrs/src/data/base64 escape hatch.
 IF v::text ~* 'data[[:space:]]*:[[:space:]]*image/' OR
    v::text ~ '(iVBORw0KGgo|/9j/|R0lGOD|UklGR[A-Za-z0-9+/]{6}XRUJQ)' THEN
    RAISE EXCEPTION 'MIGRATION_INLINE_IMAGE'; END IF;
 RETURN jsonb_build_object('profile','migration-document-poc-1','workspaceId',(v->>'workspaceId')::uuid,
  'sourceManifestHash',v->>'sourceManifestHash',
  'assets',(SELECT coalesce(jsonb_agg(items.value ORDER BY items.value->>'objectId'),'[]') FROM jsonb_array_elements(aa) items(value)),
  'documents',(SELECT coalesce(jsonb_agg(items.value ORDER BY items.value->>'id'),'[]') FROM jsonb_array_elements(dd) items(value)));
END $$;
CREATE OR REPLACE FUNCTION wjb_migration.current_manifest(p_job uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('profile',j.profile,'workspaceId',j.workspace_id,'sourceManifestHash',j.source_manifest_hash,
  'assets',(SELECT coalesce(jsonb_agg(jsonb_build_object('objectId',a.object_id,'sha256',a.sha256,'bytes',a.bytes) ORDER BY a.object_id),'[]') FROM wjb_migration.asset a WHERE a.job_id=j.id),
  'documents',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'blocks',d.blocks) ORDER BY d.id),'[]') FROM wjb_migration.document d WHERE d.job_id=j.id))
 FROM wjb_migration.job j WHERE j.id=p_job
$$;
CREATE OR REPLACE FUNCTION public.wjb_v2_migration_command(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE action text:=p_request->>'action';u uuid:=(p_request->>'userId')::uuid;
 s uuid:=(p_request->>'sessionId')::uuid;dev uuid:=(p_request->>'deviceId')::uuid;
 jid uuid:=(p_request->>'jobId')::uuid;p jsonb:=p_request->'params';j wjb_migration.job;
 norm jsonb;mh text;ws uuid;v jsonb;a wjb_gateway.asset;ma wjb_migration.asset;oid uuid;
 op uuid;ver bigint;settled boolean;
BEGIN
 IF NOT wjb_migration.keys_exact(p_request,ARRAY['action','userId','sessionId','deviceId','jobId','params']) OR
    action NOT IN('start','status','renew','observe','attest','prepare_publish','publish','publication','cancel','confirm_absent','finish_cancel') OR
    u IS NULL OR s IS NULL OR dev IS NULL OR jid IS NULL OR jsonb_typeof(p)<>'object'
    OR octet_length(p_request::text)>65536 THEN RAISE EXCEPTION 'MIGRATION_INVALID_REQUEST'; END IF;
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
   VALUES(jid,ws,u,dev,norm->>'sourceManifestHash',mh,'migration-document-poc-1','staging') RETURNING * INTO j;
  FOR v IN SELECT value FROM jsonb_array_elements(norm->'assets') LOOP
   INSERT INTO wjb_migration.asset(job_id,workspace_id,object_id,sha256,bytes) VALUES(jid,ws,(v->>'objectId')::uuid,v->>'sha256',(v->>'bytes')::integer);
   PERFORM public.wjb_v2_asset_command(jsonb_build_object('action','reserve','userId',u,'sessionId',s,
    'scope',jsonb_build_object('workspaceId',ws,'assetId',v->>'objectId','deviceId',dev,'generation','1'),
    'params',jsonb_build_object('sha256',v->>'sha256','bytes',(v->>'bytes')::integer)));
  END LOOP;
  FOR v IN SELECT value FROM jsonb_array_elements(norm->'documents') LOOP
   INSERT INTO wjb_migration.document VALUES(jid,(v->>'id')::uuid,v->>'title',v->'blocks');
  END LOOP;
  RETURN jsonb_build_object('jobId',jid,'state','staging','manifestHash',mh,'profile',j.profile,'workspaceId',j.workspace_id,'sourceManifestHash',j.source_manifest_hash);
 END IF;
 IF NOT wjb_migration.keys_exact(p,CASE action
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
  IF encode(sha256(convert_to(wjb_migration.current_manifest(jid)::text,'UTF8')),'hex')<>j.manifest_hash THEN RAISE EXCEPTION 'MIGRATION_METADATA_CHANGED'; END IF;
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
DROP FUNCTION wjb_migration.normalize_workspace(jsonb);
DROP FUNCTION wjb_migration.board_valid(jsonb,text,boolean,jsonb);
DROP FUNCTION wjb_migration.rich_valid(jsonb,text,jsonb,integer);
DROP FUNCTION wjb_migration.image_free(jsonb,integer);
DROP FUNCTION wjb_migration.canonical(jsonb);
DROP FUNCTION wjb_migration.workspace_contract(integer);
DROP TABLE wjb_migration.workspace_record;
DROP TABLE wjb_migration.workspace_header;
ALTER TABLE wjb_migration.job DROP CONSTRAINT job_profile_check;
ALTER TABLE wjb_migration.job ADD CHECK(profile='migration-document-poc-1');
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wjb_migration FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
