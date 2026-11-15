-- SELECT only. 010 installed: upload tables (RLS, no direct access), paged actions, server-only RPC.
SELECT jsonb_build_object(
 'uploadTables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wjb_migration' AND c.relname IN('upload','upload_page') AND c.relkind='r' AND c.relrowsecurity),
 'tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wjb_migration' AND c.relkind='r'),
 'rlsTables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wjb_migration' AND c.relkind='r' AND c.relrowsecurity),
 'pagedActions',(SELECT prosrc LIKE '%upload_begin%' AND prosrc LIKE '%start_upload%' FROM pg_proc WHERE oid='public.wjb_v2_migration_command(jsonb)'::regprocedure),
 'core',to_regprocedure('wjb_migration.command_core(jsonb)') IS NOT NULL,
 'recordLimit20000',(SELECT prosrc LIKE '%jsonb_array_length(v->''records'')>20000%' FROM pg_proc WHERE oid='wjb_migration.normalize_workspace(jsonb)'::regprocedure),
 'assetLimit10MB',(SELECT prosrc LIKE '%v_bytes>10485760%' AND prosrc LIKE '%>=2000%' FROM pg_proc WHERE oid='public.wjb_v2_asset_command(jsonb)'::regprocedure)
   AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='wjb_gateway.asset'::regclass AND conname='asset_bytes_check') LIKE '%10485760%'
   AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='wjb_migration.asset'::regclass AND conname='asset_bytes_check') LIKE '%10485760%',
 'quotaDefault',(SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='wjb_gateway.workspace'::regclass AND a.attname='quota_bytes'),
 'deviceRPC',has_function_privilege('service_role','public.wjb_v2_device_register(uuid,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.wjb_v2_device_register(uuid,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.wjb_v2_device_register(uuid,uuid,uuid)','EXECUTE'),
 'clientRPC',has_function_privilege('anon','public.wjb_v2_migration_command(jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.wjb_v2_migration_command(jsonb)','EXECUTE'),
 'serviceRPC',has_function_privilege('service_role','public.wjb_v2_migration_command(jsonb)','EXECUTE'),
 'directTableAccess',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wjb_migration' AND c.relkind='r' AND has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')),
 'privateExecute',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='wjb_migration' AND (has_function_privilege('service_role',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))),
 'unsafeSearchPaths',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='wjb_migration' AND NOT('search_path=pg_catalog'=ANY(coalesce(p.proconfig,'{}'::text[])))),
 'cloudApplied',false,'productActivationAllowed',false);
