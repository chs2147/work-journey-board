-- Read-only target inspection. No user/session bodies, object names, or keys.
SELECT jsonb_build_object(
 'inspection_role',current_user,
 'postgres_version',current_setting('server_version'),
 'physical_database_bytes',pg_database_size(current_database()),
 'auth_columns',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod)) ORDER BY c.relname,a.attname)
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='auth' AND a.attnum>0 AND NOT a.attisdropped AND (c.relname,a.attname) IN
 (('sessions','id'),('sessions','user_id'),('sessions','not_after'),('users','id'),('users','banned_until'),('users','deleted_at'))),
 'guard_schema_exists',to_regnamespace('wjb_v2_cloud') IS NOT NULL,
 'metadata_schema_exists',to_regnamespace('wjb_gateway') IS NOT NULL,
 'public_name_collisions',(SELECT coalesce(jsonb_agg(p.oid::regprocedure::text ORDER BY p.proname),'[]'::jsonb)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN ('wjb_v2_session_active','wjb_v2_revoke_session','wjb_v2_asset_command','wjb_v2_recovery_catalog')),
 'target_bucket',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'public',public,'file_size_limit',file_size_limit)),'[]'::jsonb) FROM storage.buckets WHERE id='wjb-v2-poc-private'),
 'storage_object_count',(SELECT count(*) FROM storage.objects),
 'storage_known_bytes',(SELECT coalesce(sum(CASE WHEN metadata->>'size' ~ '^[0-9]{1,18}$' THEN (metadata->>'size')::bigint ELSE 0 END),0) FROM storage.objects),
 'storage_unknown_size_count',(SELECT count(*) FROM storage.objects WHERE coalesce(metadata->>'size','') !~ '^[0-9]{1,18}$'),
 'storage_objects_rls',(SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND c.relname='objects'),
 'storage_policy_count',(SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects')
) AS inspection;
