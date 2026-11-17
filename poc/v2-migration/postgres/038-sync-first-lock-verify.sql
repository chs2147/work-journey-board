-- SELECT only. 037 installed: first sync locks the job row; search_path fixed; not callable by API roles.
SELECT jsonb_build_object(
 'locked',position('037:' IN pg_get_functiondef('wjb_sync.ensure_space(uuid,uuid)'::regprocedure))>0
   AND position('FOR UPDATE' IN pg_get_functiondef('wjb_sync.ensure_space(uuid,uuid)'::regprocedure))>0,
 'searchPath',(SELECT 'search_path=pg_catalog'=ANY(coalesce(proconfig,'{}'::text[])) FROM pg_proc WHERE oid='wjb_sync.ensure_space(uuid,uuid)'::regprocedure),
 'closed',NOT has_function_privilege('service_role','wjb_sync.ensure_space(uuid,uuid)','EXECUTE')
   AND NOT has_function_privilege('authenticated','wjb_sync.ensure_space(uuid,uuid)','EXECUTE'),
 'cloudApplied',false);
