-- REVIEW ONLY; no cloud auto-apply. Development project only (docs/v2-design/93).
-- Apply once after 019. E+: applied push requests are kept 7 days (cleanup inside push for the same workspace) +
-- index for that cleanup. Tables, limits and every other rule of 019 unchanged.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF to_regnamespace('wjb_sync') IS NULL THEN RAISE EXCEPTION 'MIGRATION_019_REQUIRED'; END IF;
 IF (SELECT prosrc LIKE '%022 E+%' FROM pg_proc WHERE oid='public.wjb_v2_workspace_sync(jsonb)'::regprocedure) THEN RAISE EXCEPTION 'MIGRATION_022_ALREADY_APPLIED'; END IF;
END $$;
CREATE INDEX applied_by_age ON wjb_sync.applied(workspace_id,created_at);
CREATE OR REPLACE FUNCTION public.wjb_v2_workspace_sync(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE action text:=p_request->>'action';u uuid;s uuid;dev uuid;p jsonb:=p_request->'params';ws uuid;
 sp wjb_sync.space;op uuid;rh text;done wjb_sync.applied;c jsonb;cur wjb_sync.record;conflicts jsonb:='[]';
 out jsonb:='[]';v_seq bigint;v_base bigint;n integer:=0;used integer:=0;sz integer;lim integer;after_seq bigint;
 more boolean:=false;last_seq bigint;r record;live integer;
BEGIN
 IF action IS NULL OR action NOT IN('push','pull','asset_declare') THEN RAISE EXCEPTION 'SYNC_INVALID_REQUEST'; END IF;
 IF NOT wjb_migration.keys_exact(p_request,ARRAY['action','userId','sessionId','deviceId','params']) OR jsonb_typeof(p)<>'object'
    OR octet_length(p_request::text)>1100000 THEN RAISE EXCEPTION 'SYNC_INVALID_REQUEST'; END IF;
 u:=(p_request->>'userId')::uuid;s:=(p_request->>'sessionId')::uuid;dev:=(p_request->>'deviceId')::uuid;
 PERFORM 1 FROM wjb_gateway.device WHERE id=dev AND user_id=u AND session_id=s AND NOT revoked;
 IF NOT FOUND OR NOT public.wjb_v2_session_active(u,s) THEN RAISE EXCEPTION 'SYNC_ACCESS_DENIED'; END IF;
 ws:=(p->>'workspaceId')::uuid;
 IF ws IS NULL THEN RAISE EXCEPTION 'SYNC_INVALID_REQUEST'; END IF;

 IF action='asset_declare' THEN
  IF NOT wjb_migration.keys_exact(p,ARRAY['workspaceId','objectId','sha256','bytes']) OR jsonb_typeof(p->'bytes')<>'number'
     OR (p->>'sha256') !~ '^[0-9a-f]{64}$' OR (p->>'bytes') !~ '^[1-9][0-9]{0,7}$' OR (p->>'bytes')::integer>10485760
     OR (p->>'objectId')::uuid IS NULL THEN RAISE EXCEPTION 'SYNC_INVALID_REQUEST'; END IF;
  PERFORM wjb_sync.ensure_space(ws,u);
  IF (SELECT count(*) FROM wjb_sync.asset_declared WHERE workspace_id=ws)>=5000 THEN RAISE EXCEPTION 'SYNC_LIMIT'; END IF;
  INSERT INTO wjb_sync.asset_declared(workspace_id,object_id,sha256,bytes,device_id)
   VALUES(ws,(p->>'objectId')::uuid,p->>'sha256',(p->>'bytes')::integer,dev) ON CONFLICT DO NOTHING;
  -- same object id must keep the same content (replay safe, no rebinding)
  PERFORM 1 FROM wjb_sync.asset_declared WHERE workspace_id=ws AND object_id=(p->>'objectId')::uuid AND sha256=p->>'sha256' AND bytes=(p->>'bytes')::integer;
  IF NOT FOUND THEN RAISE EXCEPTION 'SYNC_ASSET_CONFLICT'; END IF;
  PERFORM 1 FROM wjb_gateway.asset WHERE workspace_id=ws AND id=(p->>'objectId')::uuid AND (sha256<>p->>'sha256' OR bytes<>(p->>'bytes')::integer);
  IF FOUND THEN RAISE EXCEPTION 'SYNC_ASSET_CONFLICT'; END IF;
  RETURN jsonb_build_object('declared',true,'objectId',p->>'objectId');
 END IF;

 IF action='pull' THEN
  IF NOT wjb_migration.keys_exact(p,ARRAY['workspaceId','after','limit']) OR jsonb_typeof(p->'limit')<>'number'
     OR (p->>'limit') !~ '^[1-9][0-9]{0,3}$' OR (p->>'limit')::integer>1000
     OR jsonb_typeof(p->'after')<>'string' OR (p->>'after') !~ '^(0|[1-9][0-9]{0,17})$' THEN RAISE EXCEPTION 'SYNC_INVALID_REQUEST'; END IF;
  sp:=wjb_sync.ensure_space(ws,u);
  lim:=(p->>'limit')::integer;after_seq:=(p->>'after')::bigint;
  IF after_seq>sp.seq THEN RAISE EXCEPTION 'SYNC_CURSOR_AHEAD'; END IF;
  FOR r IN SELECT x.table_name t,x.record_key k,x.value v,x.rev rv,x.seq sq FROM wjb_sync.record x
    WHERE x.workspace_id=ws AND x.seq>after_seq ORDER BY x.seq LIMIT lim+1 LOOP
   sz:=coalesce(octet_length(r.v::text),4)+octet_length(r.t)+128;
   IF n>=lim OR (n>0 AND used+sz>900000) THEN more:=true; EXIT; END IF;
   out:=out||jsonb_build_array(jsonb_build_object('table',r.t,'key',r.k,'value',r.v,'rev',r.rv,'seq',r.sq::text));
   used:=used+sz;n:=n+1;last_seq:=r.sq;
  END LOOP;
  RETURN jsonb_build_object('changes',out,'more',more,'next',coalesce(last_seq,after_seq)::text,'head',sp.seq::text);
 END IF;

 -- push: all-or-nothing. Any expected-revision mismatch = nothing applied, conflicts returned with the server value.
 IF NOT wjb_migration.keys_exact(p,ARRAY['workspaceId','opId','changes']) OR jsonb_typeof(p->'changes')<>'array'
    OR jsonb_array_length(p->'changes') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'SYNC_INVALID_REQUEST'; END IF;
 op:=(p->>'opId')::uuid;
 IF op IS NULL THEN RAISE EXCEPTION 'SYNC_INVALID_REQUEST'; END IF;
 PERFORM wjb_sync.ensure_space(ws,u);
 -- one writer per workspace at a time (same lock order as gateway: device -> workspace)
 PERFORM 1 FROM wjb_gateway.workspace WHERE id=ws AND owner_id=u FOR UPDATE;
 SELECT * INTO sp FROM wjb_sync.space WHERE workspace_id=ws AND owner_id=u FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SYNC_NOT_FOUND'; END IF;
 rh:=encode(sha256(convert_to(p::text,'UTF8')),'hex');
 SELECT * INTO done FROM wjb_sync.applied WHERE workspace_id=ws AND op_id=op;
 IF FOUND THEN
  IF done.request_hash<>rh OR done.device_id<>dev THEN RAISE EXCEPTION 'SYNC_IDEMPOTENCY_MISMATCH'; END IF;
  RETURN done.result||jsonb_build_object('replayed',true);
 END IF;
 IF (SELECT count(*)<>count(DISTINCT (e->>'table',e->>'key')) FROM jsonb_array_elements(p->'changes') e) THEN
  RAISE EXCEPTION 'SYNC_INVALID_REQUEST'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p->'changes') LOOP
  IF jsonb_typeof(c)<>'object' OR NOT wjb_migration.keys_exact(c,ARRAY['table','key','baseRev','value'])
     OR NOT ((c->>'table')=ANY(sp.tables)) OR (c->>'key') !~ '^[0-9a-f]{64}$'
     OR NOT (jsonb_typeof(c->'baseRev')='null' OR (jsonb_typeof(c->'baseRev')='number' AND (c->>'baseRev') ~ '^(0|[1-9][0-9]{0,17})$'))
     OR NOT (jsonb_typeof(c->'value') IN('null','object'))
     OR (jsonb_typeof(c->'value')='null' AND jsonb_typeof(c->'baseRev')='null')
     OR octet_length((c->'value')::text)>262144 THEN RAISE EXCEPTION 'SYNC_INVALID_CHANGE'; END IF;
  -- no image bodies in the online DB (base64 / data URL), only private-asset references
  IF (c->'value')::text ~* 'data:[a-z]+/[a-z0-9.+-]+;base64,' THEN RAISE EXCEPTION 'SYNC_INLINE_IMAGE'; END IF;
  IF jsonb_typeof(c->'value')='object' AND (c->>'table') IN('note_asset','cabi_asset') AND NOT wjb_sync.refs_ready(ws,c->'value') THEN
   RAISE EXCEPTION 'SYNC_ASSET_NOT_READY'; END IF;
  SELECT * INTO cur FROM wjb_sync.record WHERE workspace_id=ws AND table_name=c->>'table' AND record_key=c->>'key';
  v_base:=CASE WHEN jsonb_typeof(c->'baseRev')='null' THEN NULL ELSE (c->>'baseRev')::bigint END;
  IF (v_base IS NULL AND cur.record_key IS NOT NULL) OR (v_base IS NOT NULL AND (cur.record_key IS NULL OR cur.rev<>v_base)) THEN
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('table',c->>'table','key',c->>'key','baseRev',c->'baseRev',
    'rev',CASE WHEN cur.record_key IS NULL THEN NULL ELSE cur.rev END,'exists',cur.record_key IS NOT NULL,'value',cur.value));
  END IF;
 END LOOP;
 IF jsonb_array_length(conflicts)>0 THEN RETURN jsonb_build_object('applied',false,'conflicts',conflicts,'head',sp.seq::text); END IF;
 v_seq:=sp.seq;
 FOR c IN SELECT value FROM jsonb_array_elements(p->'changes') LOOP
  v_seq:=v_seq+1;
  INSERT INTO wjb_sync.record AS x(workspace_id,table_name,record_key,value,rev,seq,device_id,updated_at)
   VALUES(ws,c->>'table',c->>'key',CASE WHEN jsonb_typeof(c->'value')='null' THEN NULL ELSE c->'value' END,1,v_seq,dev,clock_timestamp())
   ON CONFLICT (workspace_id,table_name,record_key) DO UPDATE SET value=excluded.value,rev=x.rev+1,seq=excluded.seq,
    device_id=excluded.device_id,updated_at=excluded.updated_at
   RETURNING x.rev INTO v_base;
  out:=out||jsonb_build_array(jsonb_build_object('table',c->>'table','key',c->>'key','rev',v_base,'seq',v_seq::text));
 END LOOP;
 SELECT count(*) INTO live FROM wjb_sync.record WHERE workspace_id=ws AND value IS NOT NULL;
 IF live>20000 THEN RAISE EXCEPTION 'SYNC_LIMIT'; END IF;
 UPDATE wjb_sync.space x SET seq=v_seq WHERE x.workspace_id=ws;
 c:=jsonb_build_object('applied',true,'records',out,'head',v_seq::text);
 INSERT INTO wjb_sync.applied(workspace_id,op_id,device_id,request_hash,result) VALUES(ws,op,dev,rh,c);
 -- 022 E+: 처리한 요청 기록은 7일만 보관(재전송은 분 단위 — 그보다 오래된 같은 번호는 새 요청으로 본다)
 DELETE FROM wjb_sync.applied x WHERE x.workspace_id=ws AND x.created_at<clock_timestamp()-interval '7 days';
 RETURN c;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'SYNC_INVALID_REQUEST';
END $$;
REVOKE ALL ON FUNCTION public.wjb_v2_workspace_sync(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wjb_v2_workspace_sync(jsonb) TO service_role;
COMMIT;
