-- SELECT only. 034 installed: daily metric table and snapshot function, closed to API roles.
SELECT jsonb_build_object(
 'table',to_regclass('wjb_ops.metric_day') IS NOT NULL,
 'function',to_regprocedure('wjb_ops.snapshot_metrics(date)') IS NOT NULL,
 'searchPath',(SELECT 'search_path=pg_catalog'=ANY(coalesce(proconfig,'{}'::text[])) FROM pg_proc WHERE oid='wjb_ops.snapshot_metrics(date)'::regprocedure),
 'closed',NOT has_table_privilege('service_role','wjb_ops.metric_day','SELECT') AND NOT has_table_privilege('authenticated','wjb_ops.metric_day','SELECT')
   AND NOT has_function_privilege('service_role','wjb_ops.snapshot_metrics(date)','EXECUTE'),
 'cloudApplied',false);
