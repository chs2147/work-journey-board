-- SELECT only. 016 installed: read RPC server-only, publish check without the 60-second window.
SELECT jsonb_build_object(
 'readRPC',to_regprocedure('public.wjb_v2_workspace_read(jsonb)') IS NOT NULL,
 'readServiceOnly',has_function_privilege('service_role','public.wjb_v2_workspace_read(jsonb)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public.wjb_v2_workspace_read(jsonb)','EXECUTE')
   AND NOT has_function_privilege('anon','public.wjb_v2_workspace_read(jsonb)','EXECUTE'),
 'readSearchPath',(SELECT 'search_path=pg_catalog'=ANY(coalesce(proconfig,'{}'::text[])) FROM pg_proc WHERE oid='public.wjb_v2_workspace_read(jsonb)'::regprocedure),
 'publishByIoVersion',(SELECT prosrc NOT LIKE '%60 seconds%' AND prosrc LIKE '%verified_version IS DISTINCT FROM x.io_version%' FROM pg_proc WHERE oid='wjb_migration.command_core(jsonb)'::regprocedure),
 'privateExecute',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='wjb_migration' AND (has_function_privilege('service_role',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))),
 'cloudApplied',false,'productActivationAllowed',false);
