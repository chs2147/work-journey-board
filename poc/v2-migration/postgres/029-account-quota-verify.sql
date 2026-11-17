-- SELECT only. 028 installed: limit triggers on the rows they guard, defaults/safety line, account RPC server-only,
-- ops schema not reachable by API roles, at most one admin.
SELECT jsonb_build_object(
 'schema',to_regnamespace('wjb_ops') IS NOT NULL,
 'triggers',(SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'wjb_ops_%' AND NOT tgisinternal)=7,
 'defaults',(SELECT jsonb_object_agg(key,value) FROM wjb_ops.setting),
 'admins',(SELECT count(*) FROM wjb_ops.admin),
 'accountServiceOnly',has_function_privilege('service_role','public.wjb_v2_account(jsonb)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public.wjb_v2_account(jsonb)','EXECUTE')
   AND NOT has_function_privilege('anon','public.wjb_v2_account(jsonb)','EXECUTE'),
 'accountSearchPath',(SELECT 'search_path=pg_catalog'=ANY(coalesce(proconfig,'{}'::text[])) FROM pg_proc WHERE oid='public.wjb_v2_account(jsonb)'::regprocedure),
 'opsClosed',NOT has_schema_privilege('authenticated','wjb_ops','USAGE') AND NOT has_schema_privilege('anon','wjb_ops','USAGE')
   AND NOT has_schema_privilege('service_role','wjb_ops','USAGE'),
 'cloudApplied',false,'productActivationAllowed',false);
