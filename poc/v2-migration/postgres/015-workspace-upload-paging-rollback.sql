-- Back to the exact 010 wrapper. Refuses while an upload is staged whose page count only 013 allows.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF NOT (SELECT prosrc LIKE '%013 D-d%' FROM pg_proc WHERE oid='public.wjb_v2_migration_command(jsonb)'::regprocedure) THEN RAISE EXCEPTION 'MIGRATION_013_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM wjb_migration.upload WHERE records<=(pages-1)*1000) THEN RAISE EXCEPTION 'MIGRATION_PAGING_ROLLBACK_NOT_EMPTY'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.wjb_v2_migration_command(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE action text:=p_request->>'action';u uuid;s uuid;dev uuid;jid uuid;p jsonb:=p_request->'params';
 up wjb_migration.upload;j wjb_migration.job;idx integer;recs jsonb;have jsonb;env jsonb;res jsonb;
BEGIN
 IF action IS NULL OR action NOT IN('upload_begin','upload_page','upload_status','start_upload') THEN RETURN wjb_migration.command_core(p_request); END IF;
 u:=(p_request->>'userId')::uuid;s:=(p_request->>'sessionId')::uuid;dev:=(p_request->>'deviceId')::uuid;jid:=(p_request->>'jobId')::uuid;
 IF NOT wjb_migration.keys_exact(p_request,ARRAY['action','userId','sessionId','deviceId','jobId','params']) OR
    u IS NULL OR s IS NULL OR dev IS NULL OR jid IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p_request::text)>1048576
    THEN RAISE EXCEPTION 'MIGRATION_INVALID_REQUEST'; END IF;
 PERFORM 1 FROM wjb_gateway.device WHERE id=dev AND user_id=u AND session_id=s AND NOT revoked FOR SHARE;
 IF NOT FOUND OR NOT public.wjb_v2_session_active(u,s) THEN RAISE EXCEPTION 'MIGRATION_ACCESS_DENIED'; END IF;
 IF action='upload_begin' THEN
  -- header = the envelope without records (assets, tableStats, exclusions …); pages/records = what will follow
  IF NOT wjb_migration.keys_exact(p,ARRAY['header','pages','records']) OR jsonb_typeof(p->'header')<>'object' OR p->'header' ? 'records'
     OR jsonb_typeof(p->'pages')<>'number' OR jsonb_typeof(p->'records')<>'number' OR (p->>'pages') !~ '^[1-9][0-9]*$' OR (p->>'records') !~ '^[1-9][0-9]*$'
     OR (p->>'pages')::integer>32 OR (p->>'records')::integer>20000 OR (p->>'records')::integer>(p->>'pages')::integer*1000
     OR (p->>'records')::integer<=((p->>'pages')::integer-1)*1000 THEN RAISE EXCEPTION 'MIGRATION_INVALID_PARAMS'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('migration-start:'||u::text,0));
  SELECT * INTO up FROM wjb_migration.upload WHERE id=jid;
  IF FOUND THEN
   IF up.owner_id<>u OR up.device_id<>dev THEN RAISE EXCEPTION 'MIGRATION_ACCESS_DENIED'; END IF;
   IF up.header<>p->'header' OR up.pages<>(p->>'pages')::integer OR up.records<>(p->>'records')::integer THEN RAISE EXCEPTION 'MIGRATION_IDEMPOTENCY_MISMATCH'; END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM wjb_migration.job WHERE id=jid) THEN RAISE EXCEPTION 'MIGRATION_IDEMPOTENCY_MISMATCH'; END IF;
   IF (SELECT count(*) FROM wjb_migration.upload WHERE owner_id=u)>=4 THEN RAISE EXCEPTION 'MIGRATION_LIMIT'; END IF;
   INSERT INTO wjb_migration.upload(id,owner_id,device_id,header,pages,records) VALUES(jid,u,dev,p->'header',(p->>'pages')::integer,(p->>'records')::integer) RETURNING * INTO up;
  END IF;
  RETURN jsonb_build_object('uploadId',jid,'pages',up.pages,'records',up.records,
   'received',(SELECT coalesce(jsonb_agg(page_index ORDER BY page_index),'[]') FROM wjb_migration.upload_page WHERE upload_id=jid));
 END IF;
 SELECT * INTO up FROM wjb_migration.upload WHERE id=jid AND owner_id=u AND device_id=dev FOR UPDATE;
 IF action='upload_page' THEN
  IF NOT FOUND THEN RAISE EXCEPTION 'MIGRATION_UPLOAD_NOT_FOUND'; END IF;
  -- sha256 = gateway hash of the exact page bytes it received (trusted server parameter, not recomputed here)
  IF NOT wjb_migration.keys_exact(p,ARRAY['index','sha256','records']) OR jsonb_typeof(p->'index')<>'number' OR (p->>'index') !~ '^(0|[1-9][0-9]*)$'
     OR coalesce(p->>'sha256','') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p->'records')<>'array' OR jsonb_array_length(p->'records') NOT BETWEEN 1 AND 1000
     THEN RAISE EXCEPTION 'MIGRATION_INVALID_PARAMS'; END IF;
  idx:=(p->>'index')::integer;
  IF idx>=up.pages THEN RAISE EXCEPTION 'MIGRATION_INVALID_PARAMS'; END IF;
  SELECT body INTO have FROM wjb_migration.upload_page WHERE upload_id=jid AND page_index=idx;
  IF FOUND THEN
   IF have<>p->'records' THEN RAISE EXCEPTION 'MIGRATION_PAGE_CHANGED'; END IF;
  ELSE
   INSERT INTO wjb_migration.upload_page(upload_id,page_index,sha256,body) VALUES(jid,idx,p->>'sha256',p->'records');
  END IF;
  RETURN jsonb_build_object('uploadId',jid,'index',idx,'stored',true);
 END IF;
 IF action='upload_status' THEN
  IF NOT wjb_migration.keys_exact(p,ARRAY[]::text[]) THEN RAISE EXCEPTION 'MIGRATION_INVALID_PARAMS'; END IF;
  IF NOT FOUND THEN
   SELECT * INTO j FROM wjb_migration.job WHERE id=jid AND owner_id=u AND device_id=dev;
   IF NOT FOUND THEN RAISE EXCEPTION 'MIGRATION_UPLOAD_NOT_FOUND'; END IF;
   RETURN jsonb_build_object('uploadId',jid,'started',true,'jobId',j.id,'state',j.state,'manifestHash',j.manifest_hash,'profile',j.profile,'workspaceId',j.workspace_id,'sourceManifestHash',j.source_manifest_hash);
  END IF;
  RETURN jsonb_build_object('uploadId',jid,'started',false,'pages',up.pages,'records',up.records,
   'received',(SELECT coalesce(jsonb_agg(page_index ORDER BY page_index),'[]') FROM wjb_migration.upload_page WHERE upload_id=jid));
 END IF;
 -- start_upload: all pages present → assemble → unchanged start logic → staged pages removed
 IF NOT wjb_migration.keys_exact(p,ARRAY[]::text[]) THEN RAISE EXCEPTION 'MIGRATION_INVALID_PARAMS'; END IF;
 IF NOT FOUND THEN
  SELECT * INTO j FROM wjb_migration.job WHERE id=jid AND owner_id=u AND device_id=dev;
  IF NOT FOUND THEN RAISE EXCEPTION 'MIGRATION_UPLOAD_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('jobId',j.id,'state',j.state,'manifestHash',j.manifest_hash,'profile',j.profile,'workspaceId',j.workspace_id,'sourceManifestHash',j.source_manifest_hash);
 END IF;
 IF (SELECT count(*) FROM wjb_migration.upload_page WHERE upload_id=jid)<>up.pages THEN RAISE EXCEPTION 'MIGRATION_UPLOAD_INCOMPLETE'; END IF;
 recs:=(SELECT coalesce(jsonb_agg(e.val ORDER BY pg.page_index,e.o),'[]') FROM wjb_migration.upload_page pg,jsonb_array_elements(pg.body) WITH ORDINALITY e(val,o) WHERE pg.upload_id=jid);
 IF jsonb_array_length(recs)<>up.records THEN RAISE EXCEPTION 'MIGRATION_UPLOAD_INCOMPLETE'; END IF;
 env:=up.header||jsonb_build_object('records',recs);
 PERFORM set_config('wjb.upload_start','1',true);
 res:=wjb_migration.command_core(jsonb_build_object('action','start','userId',u,'sessionId',s,'deviceId',dev,'jobId',jid,'params',env));
 PERFORM set_config('wjb.upload_start','',true);
 DELETE FROM wjb_migration.upload_page WHERE upload_id=jid;
 DELETE FROM wjb_migration.upload WHERE id=jid;
 RETURN res;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'MIGRATION_INVALID_REQUEST';
END $$;
REVOKE ALL ON FUNCTION public.wjb_v2_migration_command(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wjb_v2_migration_command(jsonb) TO service_role;
COMMIT;
