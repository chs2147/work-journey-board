-- SELECT only. 019 installed: sync RPC server-only, wjb_sync tables private (RLS, no grants), private helpers not callable.
SELECT jsonb_build_object(
 'syncRPC',to_regprocedure('public.wjb_v2_workspace_sync(jsonb)') IS NOT NULL,
 'syncServiceOnly',has_function_privilege('service_role','public.wjb_v2_workspace_sync(jsonb)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public.wjb_v2_workspace_sync(jsonb)','EXECUTE')
   AND NOT has_function_privilege('anon','public.wjb_v2_workspace_sync(jsonb)','EXECUTE'),
 'syncSearchPath',(SELECT 'search_path=pg_catalog'=ANY(coalesce(proconfig,'{}'::text[])) FROM pg_proc WHERE oid='public.wjb_v2_workspace_sync(jsonb)'::regprocedure),
 'tables',(SELECT count(*) FROM pg_tables WHERE schemaname='wjb_sync'),
 'rlsTables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wjb_sync' AND c.relkind='r' AND c.relrowsecurity),
 'directTableAccess',EXISTS(SELECT 1 FROM pg_tables t CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r(role)
   WHERE t.schemaname='wjb_sync' AND has_table_privilege(r.role,format('%I.%I',t.schemaname,t.tablename),'SELECT,INSERT,UPDATE,DELETE')),
 'schemaUsage',EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r(role) WHERE has_schema_privilege(r.role,'wjb_sync','USAGE')),
 'privateExecute',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='wjb_sync' AND (has_function_privilege('service_role',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))),
 'unsafeSearchPaths',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='wjb_sync' AND NOT ('search_path=pg_catalog'=ANY(coalesce(p.proconfig,'{}'::text[])))),
 'inlineImageGuard',(SELECT prosrc LIKE '%SYNC_INLINE_IMAGE%' AND prosrc LIKE '%SYNC_ASSET_NOT_READY%' FROM pg_proc WHERE oid='public.wjb_v2_workspace_sync(jsonb)'::regprocedure),
 'assetGateSync',(SELECT prosrc LIKE '%wjb_sync.asset_declared%' FROM pg_proc WHERE oid='wjb_migration.asset_gate()'::regprocedure),
 'cloudApplied',false,'productActivationAllowed',false);
