-- Run SELECT through the reviewed postgres management connection: cron RLS is user-scoped.
SELECT jsonb_build_object(
 'executionRole',current_user,
 'cronTimeZone',current_setting('cron.timezone',true),
 'cronVersion',(SELECT extversion FROM pg_extension WHERE extname='pg_cron'),
 'heartbeatRows',(SELECT count(*) FROM public.keepalive_pings),
 'lastPing',(SELECT pinged_at FROM public.keepalive_pings WHERE id=1),
 'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.keepalive_pings'::regclass),
 'clientTableAccess',has_table_privilege('anon','public.keepalive_pings','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated','public.keepalive_pings','SELECT,INSERT,UPDATE,DELETE'),
 'serviceTableAccess',has_table_privilege('service_role','public.keepalive_pings','SELECT,INSERT,UPDATE,DELETE'),
 'jobs',(SELECT jsonb_agg(jsonb_build_object('jobid',jobid,'name',jobname,'schedule',schedule,'active',active,'username',username,'command',command)) FROM cron.job WHERE jobname IN('keepalive_ping','wjb_keepalive_probe')),
 'recentRuns',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM (SELECT d.jobid,d.status,d.return_message,d.start_time,d.end_time FROM cron.job_run_details d JOIN cron.job j USING(jobid) WHERE j.jobname='keepalive_ping' ORDER BY d.start_time DESC LIMIT 3) r)
) AS keepalive;
