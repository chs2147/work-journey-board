-- SELECT only. 025 installed: list returns workspace labels, helper is not callable by any API role, read RPC still server-only.
SELECT jsonb_build_object(
 'label',(SELECT prosrc LIKE '%025 UX%' FROM pg_proc WHERE oid='public.wjb_v2_workspace_read(jsonb)'::regprocedure),
 'helper',to_regprocedure('wjb_migration.workspace_label(jsonb)') IS NOT NULL
   AND NOT has_function_privilege('service_role','wjb_migration.workspace_label(jsonb)','EXECUTE')
   AND NOT has_function_privilege('authenticated','wjb_migration.workspace_label(jsonb)','EXECUTE')
   AND NOT has_function_privilege('anon','wjb_migration.workspace_label(jsonb)','EXECUTE'),
 'readServiceOnly',has_function_privilege('service_role','public.wjb_v2_workspace_read(jsonb)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public.wjb_v2_workspace_read(jsonb)','EXECUTE')
   AND NOT has_function_privilege('anon','public.wjb_v2_workspace_read(jsonb)','EXECUTE'),
 'readSearchPath',(SELECT 'search_path=pg_catalog'=ANY(coalesce(proconfig,'{}'::text[])) FROM pg_proc WHERE oid='public.wjb_v2_workspace_read(jsonb)'::regprocedure),
 'cloudApplied',false,'productActivationAllowed',false);
