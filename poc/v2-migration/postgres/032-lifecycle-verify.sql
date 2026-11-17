-- SELECT only. 031 installed: schema closed to API roles, both RPCs server-only with a fixed search_path, grace 7 days.
SELECT jsonb_build_object(
 'schema',to_regnamespace('wjb_life') IS NOT NULL,
 'tables',(SELECT count(*) FROM pg_tables WHERE schemaname='wjb_life')=3,
 'grace',wjb_life.grace()::text,
 'userServiceOnly',has_function_privilege('service_role','public.wjb_v2_lifecycle(jsonb)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public.wjb_v2_lifecycle(jsonb)','EXECUTE')
   AND NOT has_function_privilege('anon','public.wjb_v2_lifecycle(jsonb)','EXECUTE'),
 'workerServiceOnly',has_function_privilege('service_role','public.wjb_v2_lifecycle_worker(jsonb)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public.wjb_v2_lifecycle_worker(jsonb)','EXECUTE')
   AND NOT has_function_privilege('anon','public.wjb_v2_lifecycle_worker(jsonb)','EXECUTE'),
 'searchPath',(SELECT bool_and('search_path=pg_catalog'=ANY(coalesce(proconfig,'{}'::text[]))) FROM pg_proc
   WHERE oid IN('public.wjb_v2_lifecycle(jsonb)'::regprocedure,'public.wjb_v2_lifecycle_worker(jsonb)'::regprocedure,
    'wjb_life.purge_space(uuid,uuid,text,uuid)'::regprocedure,'wjb_life.sweep_orphans(timestamptz)'::regprocedure)),
 'lifeClosed',NOT has_schema_privilege('authenticated','wjb_life','USAGE') AND NOT has_schema_privilege('anon','wjb_life','USAGE')
   AND NOT has_schema_privilege('service_role','wjb_life','USAGE'),
 'cloudApplied',false,'productActivationAllowed',false);
