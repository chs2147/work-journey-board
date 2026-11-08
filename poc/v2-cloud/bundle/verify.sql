-- Read-only verification after local/approved installation. No user bodies/keys.
WITH target_functions AS (
 SELECT p.oid,p.proname,n.nspname,p.proowner,p.proconfig,p.prosecdef,p.proacl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('wjb_v2_cloud','wjb_gateway') OR
  (n.nspname='public' AND p.proname IN ('wjb_v2_session_active','wjb_v2_revoke_session','wjb_v2_asset_command','wjb_v2_recovery_catalog'))
), target_tables AS (
 SELECT c.oid,c.relname,n.nspname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('wjb_v2_cloud','wjb_gateway') AND c.relkind='r'
)
SELECT jsonb_build_object(
 'schemaCount',(SELECT count(*) FROM pg_namespace WHERE nspname IN ('wjb_v2_cloud','wjb_gateway')),
 'tableCount',(SELECT count(*) FROM target_tables),
 'rlsEnabledCount',(SELECT count(*) FROM target_tables WHERE relrowsecurity),
 'functionCount',(SELECT count(*) FROM target_functions),
 'publicRpcCount',(SELECT count(*) FROM target_functions WHERE nspname='public'),
 'unsafeSearchPaths',(SELECT count(*) FROM target_functions WHERE NOT coalesce(proconfig @> ARRAY['search_path=pg_catalog'],false)),
 'clientExecutableCount',(SELECT count(*) FROM target_functions WHERE has_function_privilege('authenticated',oid,'EXECUTE') OR has_function_privilege('anon',oid,'EXECUTE')),
 'publicExecutableCount',(SELECT count(*) FROM target_functions f WHERE EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')),
 'servicePublicExecutableCount',(SELECT count(*) FROM target_functions WHERE nspname='public' AND has_function_privilege('service_role',oid,'EXECUTE')),
 'serviceDirectTableAccessCount',(SELECT count(*) FROM target_tables WHERE has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE')),
 'owners',(SELECT jsonb_agg(DISTINCT jsonb_build_object('role',r.rolname,'superuser',r.rolsuper,'bypassRls',r.rolbypassrls)) FROM target_functions f JOIN pg_roles r ON r.oid=f.proowner)
) AS verification;
