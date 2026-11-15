-- SELECT only. 013 installed: free page count + stale cleanup, ACL unchanged.
SELECT jsonb_build_object(
 'pagingFree',(SELECT prosrc LIKE '%(p->>''records'')::integer<(p->>''pages'')::integer%' AND prosrc NOT LIKE '%-1)*1000%' FROM pg_proc WHERE oid='public.wjb_v2_migration_command(jsonb)'::regprocedure),
 'staleCleanup',(SELECT prosrc LIKE '%013 D-d%' AND prosrc LIKE '%interval ''24 hours''%' FROM pg_proc WHERE oid='public.wjb_v2_migration_command(jsonb)'::regprocedure),
 'clientRPC',has_function_privilege('anon','public.wjb_v2_migration_command(jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.wjb_v2_migration_command(jsonb)','EXECUTE'),
 'serviceRPC',has_function_privilege('service_role','public.wjb_v2_migration_command(jsonb)','EXECUTE'),
 'searchPath',(SELECT 'search_path=pg_catalog'=ANY(coalesce(proconfig,'{}'::text[])) FROM pg_proc WHERE oid='public.wjb_v2_migration_command(jsonb)'::regprocedure),
 'cloudApplied',false,'productActivationAllowed',false);
