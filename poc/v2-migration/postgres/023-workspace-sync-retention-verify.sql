-- SELECT only. 022 installed: 7-day cleanup of applied requests inside push, index present, RPC still server-only.
SELECT jsonb_build_object(
 'retention',(SELECT prosrc LIKE '%022 E+%' AND prosrc LIKE '%interval ''7 days''%' FROM pg_proc WHERE oid='public.wjb_v2_workspace_sync(jsonb)'::regprocedure),
 'index',to_regclass('wjb_sync.applied_by_age') IS NOT NULL,
 'syncServiceOnly',has_function_privilege('service_role','public.wjb_v2_workspace_sync(jsonb)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public.wjb_v2_workspace_sync(jsonb)','EXECUTE')
   AND NOT has_function_privilege('anon','public.wjb_v2_workspace_sync(jsonb)','EXECUTE'),
 'syncSearchPath',(SELECT 'search_path=pg_catalog'=ANY(coalesce(proconfig,'{}'::text[])) FROM pg_proc WHERE oid='public.wjb_v2_workspace_sync(jsonb)'::regprocedure),
 'cloudApplied',false,'productActivationAllowed',false);
