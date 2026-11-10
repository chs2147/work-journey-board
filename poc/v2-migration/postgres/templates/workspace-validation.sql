-- Additional full-workspace PoC profile; product activation stays disabled.
CREATE OR REPLACE FUNCTION wjb_migration.keys_exact(v jsonb,wanted text[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 RETURN ARRAY(SELECT k FROM jsonb_object_keys(v) k ORDER BY k)=ARRAY(SELECT k FROM unnest(wanted) k ORDER BY k);
END $$;

CREATE TABLE wjb_migration.workspace_header(job_id uuid PRIMARY KEY REFERENCES wjb_migration.job(id),value jsonb NOT NULL);
CREATE TABLE wjb_migration.workspace_record(job_id uuid NOT NULL REFERENCES wjb_migration.job(id),table_name text NOT NULL,record_key text NOT NULL CHECK(record_key ~ '^[0-9a-f]{64}$'),value jsonb NOT NULL,PRIMARY KEY(job_id,table_name,record_key));
ALTER TABLE wjb_migration.workspace_header ENABLE ROW LEVEL SECURITY;
ALTER TABLE wjb_migration.workspace_record ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wjb_migration.workspace_header,wjb_migration.workspace_record FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE wjb_migration.job DROP CONSTRAINT job_profile_check;
ALTER TABLE wjb_migration.job ADD CHECK(profile IN('migration-document-poc-1','workspace-db18-map-poc-1','workspace-db19-map-poc-1'));

CREATE FUNCTION wjb_migration.canonical(v jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE out text;
BEGIN
 IF jsonb_typeof(v)='array' THEN
  SELECT '['||coalesce(string_agg(wjb_migration.canonical(value),',' ORDER BY ord),'')||']' INTO out FROM jsonb_array_elements(v) WITH ORDINALITY x(value,ord);
 ELSIF jsonb_typeof(v)='object' THEN
  SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||wjb_migration.canonical(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO out FROM jsonb_each(v);
 ELSE out:=v::text; END IF;
 RETURN out;
END $$;
CREATE FUNCTION wjb_migration.image_free(v jsonb,depth integer DEFAULT 0) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE child jsonb;parsed jsonb;t text;
BEGIN
 IF depth>64 THEN RAISE EXCEPTION 'MIGRATION_DEPTH'; END IF;
 IF jsonb_typeof(v)='string' THEN
  t:=v#>>'{}';
  IF t ~* 'data[[:space:]]*:[[:space:]]*image/' OR t ~ '(iVBORw0KGgo|/9j/|R0lGOD|UklGR[A-Za-z0-9+/]{6}XRUJQ)' THEN RAISE EXCEPTION 'MIGRATION_INLINE_IMAGE'; END IF;
  -- JSON fields remain strings in the legacy contract. Inspect their decoded contents too.
  IF left(ltrim(t),1) IN('{','[') THEN
   BEGIN parsed:=t::jsonb; EXCEPTION WHEN invalid_text_representation THEN parsed:=NULL; END;
   IF parsed IS NOT NULL THEN PERFORM wjb_migration.image_free(parsed,depth+1); END IF;
  END IF;
 ELSIF jsonb_typeof(v)='object' THEN
  FOR child IN SELECT value FROM jsonb_each(v) LOOP PERFORM wjb_migration.image_free(child,depth+1); END LOOP;
 ELSIF jsonb_typeof(v)='array' THEN
  FOR child IN SELECT value FROM jsonb_array_elements(v) LOOP PERFORM wjb_migration.image_free(child,depth+1); END LOOP;
 END IF;
END $$;
CREATE FUNCTION wjb_migration.rich_valid(n jsonb,owner_id text,records jsonb,depth integer DEFAULT 0) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE child jsonb;m jsonb;
BEGIN
 IF depth>32 OR jsonb_typeof(n) IS DISTINCT FROM 'object' OR coalesce(n->>'type','') NOT IN('doc','paragraph','heading','bulletList','orderedList','listItem','taskList','taskItem','blockquote','codeBlock','horizontalRule','hardBreak','table','tableRow','tableCell','tableHeader','image','text') THEN RAISE EXCEPTION 'MIGRATION_RICH_FORMAT'; END IF;
 IF n->>'type'='image' AND (n->'attrs' ? 'src' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(records) r WHERE r->>'table'='cabi_asset' AND r->'value'->>'id'=n->'attrs'->>'asset' AND r->'value'->>'owner_kind'='note' AND r->'value'->>'owner_id'=owner_id)) THEN RAISE EXCEPTION 'MIGRATION_IMAGE_REFERENCE'; END IF;
 IF n ? 'marks' THEN
  IF jsonb_typeof(n->'marks')<>'array' THEN RAISE EXCEPTION 'MIGRATION_RICH_FORMAT'; END IF;
  FOR m IN SELECT value FROM jsonb_array_elements(n->'marks') LOOP
   IF coalesce(m->>'type','') NOT IN('bold','italic','underline','strike','fontSize','textColor','highlight','link','code') OR (m->>'type'='link' AND coalesce(m->'attrs'->>'href','') !~* '^https?://') THEN RAISE EXCEPTION 'MIGRATION_RICH_FORMAT'; END IF;
  END LOOP;
 END IF;
 IF n ? 'content' THEN
  IF jsonb_typeof(n->'content')<>'array' THEN RAISE EXCEPTION 'MIGRATION_RICH_FORMAT'; END IF;
  FOR child IN SELECT value FROM jsonb_array_elements(n->'content') LOOP PERFORM wjb_migration.rich_valid(child,owner_id,records,depth+1); END LOOP;
 END IF;
END $$;
CREATE FUNCTION wjb_migration.board_valid(d jsonb,owner_id text,weekly boolean,records jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE b jsonb;e jsonb;w jsonb;
BEGIN
 IF d->>'v' IS DISTINCT FROM '1' OR jsonb_typeof(d->'boxes') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'MIGRATION_BOARD_FORMAT'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(d->'boxes') x GROUP BY x->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'MIGRATION_BOARD_FORMAT'; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(d->'boxes') LOOP
  IF coalesce(b->>'id','')='' OR coalesce(b->>'kind','') NOT IN('text','link','image') THEN RAISE EXCEPTION 'MIGRATION_BOARD_FORMAT'; END IF;
  IF b->>'kind'='image' AND NOT (b ? 'asset') THEN RAISE EXCEPTION 'MIGRATION_IMAGE_REFERENCE'; END IF;
  IF b ? 'asset' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(records) r WHERE r->'value'->>'id'=b->>'asset' AND ((weekly AND r->>'table'='note_asset' AND r->'value'->>'week_id'=owner_id) OR (NOT weekly AND r->>'table'='cabi_asset' AND r->'value'->>'owner_kind'='board' AND r->'value'->>'owner_id'=owner_id))) THEN RAISE EXCEPTION 'MIGRATION_IMAGE_REFERENCE'; END IF;
  IF b->>'kind'='text' THEN PERFORM wjb_migration.rich_valid(b->'content',NULL,records); END IF;
  IF b->>'kind'='link' AND coalesce(b->>'url','') !~* '^https?://' THEN RAISE EXCEPTION 'MIGRATION_LOCAL_PATH'; END IF;
  IF b ? 'widget' THEN
   w:=b->'widget';
   IF coalesce(w->>'type','') NOT IN('elapsed','timeline','important') OR EXISTS(SELECT 1 FROM jsonb_object_keys(w) k WHERE k NOT IN('type','basis','variant','weeks','milestoneEntryIds')) THEN RAISE EXCEPTION 'MIGRATION_WIDGET_FORMAT'; END IF;
  END IF;
  IF b ? 'resource' THEN
   w:=b->'resource';
   IF NOT (CASE WHEN w->>'kind'='memo' THEN wjb_migration.keys_exact(w,ARRAY['kind','weekId','boxId']) ELSE coalesce(w->>'kind','') IN('note','folder','link') AND wjb_migration.keys_exact(w,ARRAY['kind','id']) END) THEN RAISE EXCEPTION 'MIGRATION_RESOURCE_FORMAT'; END IF;
  END IF;
 END LOOP;
 FOR e IN SELECT value FROM jsonb_array_elements(coalesce(d->'edges','[]')) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'boxes') bx WHERE bx->>'id'=e->>'from') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'boxes') bx WHERE bx->>'id'=e->>'to') THEN RAISE EXCEPTION 'MIGRATION_BOARD_REFERENCE'; END IF;
 END LOOP;
END $$;
CREATE FUNCTION wjb_migration.normalize_workspace(v jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE contract jsonb;r jsonb;rowv jsonb;c jsonb;col text;t text;pk jsonb;k text;fk jsonb;ref jsonb;a jsonb;st jsonb;d jsonb;n jsonb;setting jsonb;names text[];total integer;version integer;
BEGIN
 IF NOT coalesce(wjb_migration.keys_exact(v,ARRAY['profile','workspaceId','sourceSchema','contractFingerprint','sourceManifestHash','assets','records','tableStats','exclusions','policies']),false) THEN RAISE EXCEPTION 'MIGRATION_WORKSPACE_FORMAT'; END IF;
 IF jsonb_typeof(v->'sourceSchema') IS DISTINCT FROM 'number' OR (v->>'sourceSchema') NOT IN('18','19') THEN RAISE EXCEPTION 'MIGRATION_WORKSPACE_SCHEMA'; END IF;
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
   IF version=19 AND rowv->'delete_locked' NOT IN('0'::jsonb,'1'::jsonb) THEN RAISE EXCEPTION 'MIGRATION_DELETE_LOCK'; END IF;
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
  ELSIF t='app_meta' THEN
   IF rowv->>'key'='settings' THEN
    setting:=(rowv->>'value')::jsonb;
    IF jsonb_typeof(setting)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(setting) x WHERE x NOT IN('workspace','nudgeWeeks','summary','holiday')) THEN RAISE EXCEPTION 'MIGRATION_SETTINGS'; END IF;
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
  IF (st->>'mappedRows')::integer<>total OR (st->>'sourceRows')::integer<>total+(st->>'excludedRows')::integer OR (st->>'transformedRows')::integer>total OR (st->>'excludedRows')::integer<>(CASE WHEN t='app_meta' THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'MIGRATION_ROW_COUNTS'; END IF;
 END LOOP;
 FOR d IN SELECT value FROM jsonb_array_elements(v->'exclusions') LOOP
  IF NOT coalesce(wjb_migration.keys_exact(d,ARRAY['table','key','reason']) OR wjb_migration.keys_exact(d,ARRAY['table','key','reason','field']),false) THEN RAISE EXCEPTION 'MIGRATION_EXCLUSION'; END IF;
  IF NOT ((d->>'table'='app_meta' AND d->>'key'='schema_version' AND d->>'reason'='source-format-only') OR (d->>'table'='app_meta' AND d->>'key' IN('settings.ui','settings.ai','settings.backup') AND d->>'reason'='device-preference-not-synced') OR (d->>'table'='cabinet_item' AND d->>'field'='target' AND d->>'reason'='device-filesystem-path') OR (d->>'table'='import_batch' AND d->>'field'='file_name' AND d->>'reason'='path-basename-only')) THEN RAISE EXCEPTION 'MIGRATION_EXCLUSION'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(v->'exclusions') x WHERE x->>'table'='app_meta' AND x->>'key'='schema_version' AND x->>'reason'='source-format-only')<>1 THEN RAISE EXCEPTION 'MIGRATION_EXCLUSION'; END IF;
 RETURN v||jsonb_build_object('records',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'table' COLLATE "C",x->>'key'),'[]') FROM jsonb_array_elements(v->'records') x),'assets',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'objectId'),'[]') FROM jsonb_array_elements(v->'assets') x));
END $$;
