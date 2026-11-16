-- REVIEW ONLY; no cloud auto-apply. Development project only (docs/v2-design/95 UX-2).
-- Apply once after 019 (022 may or may not be installed). The read list also returns each space's name, color and icon
-- from its settings record: the synced value first (wjb_sync.record), then the published copy. Only those three
-- fields leave the server (validated, else null). Every other action, table and limit of 016 is unchanged.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF to_regnamespace('wjb_sync') IS NULL THEN RAISE EXCEPTION 'MIGRATION_019_REQUIRED'; END IF;
 IF to_regprocedure('wjb_migration.workspace_label(jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'MIGRATION_025_ALREADY_APPLIED'; END IF;
END $$;
-- Settings record {key:'settings', value:'<json text>'} -> {name,color,icon} or null. Never raises (bad text = null).
CREATE FUNCTION wjb_migration.workspace_label(v jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE w jsonb;
BEGIN
 IF v IS NULL OR jsonb_typeof(v->'value')<>'string' OR octet_length(v->>'value')>262144 THEN RETURN NULL; END IF;
 w:=(v->>'value')::jsonb->'workspace';
 IF w IS NULL OR jsonb_typeof(w)<>'object' OR jsonb_typeof(w->'name')<>'string' OR jsonb_typeof(w->'color')<>'string'
    OR jsonb_typeof(w->'icon')<>'string' THEN RETURN NULL; END IF;
 IF char_length(w->>'name') NOT BETWEEN 1 AND 80 OR (w->>'color') !~ '^c[1-8]$' OR (w->>'icon') !~ '^[a-z][a-z0-9-]{0,23}$' THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('name',w->>'name','color',w->>'color','icon',w->>'icon');
EXCEPTION WHEN others THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION wjb_migration.workspace_label(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.wjb_v2_workspace_read(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE action text:=p_request->>'action';u uuid;s uuid;dev uuid;p jsonb:=p_request->'params';j wjb_migration.job;
 ws uuid;lim integer;after_t text;after_k text;r record;out jsonb:='[]';n integer:=0;used integer:=0;sz integer;
 more boolean:=false;last_t text;last_k text;
BEGIN
 IF action IS NULL OR action NOT IN('list','header','records') THEN RAISE EXCEPTION 'READ_INVALID_REQUEST'; END IF;
 IF NOT wjb_migration.keys_exact(p_request,ARRAY['action','userId','sessionId','deviceId','params']) OR jsonb_typeof(p)<>'object'
    OR octet_length(p_request::text)>8192 THEN RAISE EXCEPTION 'READ_INVALID_REQUEST'; END IF;
 u:=(p_request->>'userId')::uuid;s:=(p_request->>'sessionId')::uuid;dev:=(p_request->>'deviceId')::uuid;
 PERFORM 1 FROM wjb_gateway.device WHERE id=dev AND user_id=u AND session_id=s AND NOT revoked;
 IF NOT FOUND OR NOT public.wjb_v2_session_active(u,s) THEN RAISE EXCEPTION 'READ_ACCESS_DENIED'; END IF;
 IF action='list' THEN
  IF NOT wjb_migration.keys_exact(p,ARRAY[]::text[]) THEN RAISE EXCEPTION 'READ_INVALID_REQUEST'; END IF;
  RETURN jsonb_build_object('workspaces',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'workspaceId',j2.workspace_id,'jobId',j2.id,'createdAt',j2.created_at,'profile',j2.profile,
    'sourceSchema',(h.value->>'sourceSchema')::integer,'manifestHash',j2.manifest_hash,
    'records',(SELECT count(*) FROM wjb_migration.workspace_record x WHERE x.job_id=j2.id),
    'assets',(SELECT count(*) FROM wjb_migration.asset a WHERE a.job_id=j2.id),
    'assetBytes',(SELECT coalesce(sum(a.bytes),0) FROM wjb_migration.asset a WHERE a.job_id=j2.id),
    -- 025 UX: name/color/icon of the space (synced settings first, then the published copy; null when absent or malformed)
    'workspace',(SELECT CASE WHEN sv.value IS NOT NULL THEN wjb_migration.workspace_label(sv.value)
       ELSE (SELECT wjb_migration.workspace_label(x.value) FROM wjb_migration.workspace_record x
        WHERE x.job_id=j2.id AND x.table_name='app_meta' AND x.value->>'key'='settings' LIMIT 1) END
      FROM (SELECT (SELECT x.value FROM wjb_sync.record x WHERE x.workspace_id=j2.workspace_id AND x.table_name='app_meta'
        AND x.value->>'key'='settings' LIMIT 1) AS value) sv)) ORDER BY j2.created_at DESC,j2.id)
   FROM wjb_migration.job j2 JOIN wjb_migration.workspace_header h ON h.job_id=j2.id
   WHERE j2.owner_id=u AND j2.state='connected' AND j2.profile<>'migration-document-poc-1'),'[]'));
 END IF;
 ws:=(p->>'workspaceId')::uuid;
 IF ws IS NULL THEN RAISE EXCEPTION 'READ_INVALID_REQUEST'; END IF;
 SELECT * INTO j FROM wjb_migration.job WHERE workspace_id=ws AND owner_id=u AND state='connected' AND profile<>'migration-document-poc-1';
 IF NOT FOUND THEN RAISE EXCEPTION 'READ_NOT_FOUND'; END IF;
 IF action='header' THEN
  IF NOT wjb_migration.keys_exact(p,ARRAY['workspaceId']) THEN RAISE EXCEPTION 'READ_INVALID_REQUEST'; END IF;
  RETURN jsonb_build_object('workspaceId',ws,'jobId',j.id,'manifestHash',j.manifest_hash,'createdAt',j.created_at,
   'header',(SELECT h.value FROM wjb_migration.workspace_header h WHERE h.job_id=j.id),
   'assets',(SELECT coalesce(jsonb_agg(jsonb_build_object('objectId',a.object_id,'sha256',a.sha256,'bytes',a.bytes) ORDER BY a.object_id),'[]') FROM wjb_migration.asset a WHERE a.job_id=j.id),
   'records',(SELECT count(*) FROM wjb_migration.workspace_record x WHERE x.job_id=j.id));
 END IF;
 -- records: keyset pages in the manifest order (table COLLATE "C", key); at most `limit` rows and about 900KB
 IF NOT wjb_migration.keys_exact(p,ARRAY['workspaceId','manifestHash','after','limit']) OR jsonb_typeof(p->'limit')<>'number'
    OR (p->>'limit') !~ '^[1-9][0-9]{0,3}$' OR (p->>'limit')::integer>1000
    OR NOT (jsonb_typeof(p->'after')='null' OR (jsonb_typeof(p->'after')='array' AND jsonb_array_length(p->'after')=2
      AND jsonb_typeof(p->'after'->0)='string' AND jsonb_typeof(p->'after'->1)='string')) THEN RAISE EXCEPTION 'READ_INVALID_REQUEST'; END IF;
 IF p->>'manifestHash' IS DISTINCT FROM j.manifest_hash THEN RAISE EXCEPTION 'READ_MANIFEST_CHANGED'; END IF;
 lim:=(p->>'limit')::integer;after_t:=p->'after'->>0;after_k:=p->'after'->>1;
 FOR r IN SELECT x.table_name t,x.record_key k,x.value v FROM wjb_migration.workspace_record x
   WHERE x.job_id=j.id AND (after_t IS NULL OR x.table_name COLLATE "C">after_t COLLATE "C" OR (x.table_name=after_t AND x.record_key COLLATE "C">after_k COLLATE "C"))
   ORDER BY x.table_name COLLATE "C",x.record_key COLLATE "C" LIMIT lim+1 LOOP
  sz:=octet_length(r.v::text)+octet_length(r.t)+96;
  IF n>=lim OR (n>0 AND used+sz>900000) THEN more:=true; EXIT; END IF;
  out:=out||jsonb_build_array(jsonb_build_object('table',r.t,'key',r.k,'value',r.v));used:=used+sz;n:=n+1;last_t:=r.t;last_k:=r.k;
 END LOOP;
 RETURN jsonb_build_object('records',out,'more',more,'next',CASE WHEN more THEN jsonb_build_array(last_t,last_k) ELSE NULL END);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'READ_INVALID_REQUEST';
END $$;
REVOKE ALL ON FUNCTION public.wjb_v2_workspace_read(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wjb_v2_workspace_read(jsonb) TO service_role;
COMMIT;
