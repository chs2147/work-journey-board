-- Back to before 037: the exact 019 wjb_sync.ensure_space.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF position('037:' IN pg_get_functiondef('wjb_sync.ensure_space(uuid,uuid)'::regprocedure))=0 THEN RAISE EXCEPTION 'MIGRATION_037_REQUIRED'; END IF;
END $$;
CREATE OR REPLACE FUNCTION wjb_sync.ensure_space(p_ws uuid,p_owner uuid) RETURNS wjb_sync.space
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j wjb_migration.job;sp wjb_sync.space;t text[];
BEGIN
 SELECT * INTO sp FROM wjb_sync.space WHERE workspace_id=p_ws;
 IF FOUND THEN
  IF sp.owner_id<>p_owner THEN RAISE EXCEPTION 'SYNC_NOT_FOUND'; END IF;
  RETURN sp;
 END IF;
 SELECT * INTO j FROM wjb_migration.job WHERE workspace_id=p_ws AND owner_id=p_owner AND state='connected' AND profile<>'migration-document-poc-1';
 IF NOT FOUND THEN RAISE EXCEPTION 'SYNC_NOT_FOUND'; END IF;
 SELECT array_agg(k ORDER BY k) INTO t FROM wjb_migration.workspace_header h,jsonb_object_keys(h.value->'tableStats') k
  WHERE h.job_id=j.id AND k<>'kanban_ctx';
 IF t IS NULL OR cardinality(t)=0 THEN RAISE EXCEPTION 'SYNC_NOT_FOUND'; END IF;
 INSERT INTO wjb_sync.space(workspace_id,owner_id,job_id,tables) VALUES(p_ws,p_owner,j.id,t)
  ON CONFLICT (workspace_id) DO NOTHING RETURNING * INTO sp;
 IF sp.workspace_id IS NULL THEN
  SELECT * INTO sp FROM wjb_sync.space WHERE workspace_id=p_ws;
  RETURN sp;
 END IF;
 INSERT INTO wjb_sync.record(workspace_id,table_name,record_key,value,rev,seq,device_id)
  SELECT p_ws,x.table_name,x.record_key,x.value,0,0,NULL FROM wjb_migration.workspace_record x WHERE x.job_id=j.id;
 RETURN sp;
END $$;
REVOKE ALL ON FUNCTION wjb_sync.ensure_space(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
