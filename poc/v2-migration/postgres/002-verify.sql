-- Read-only inventory/ACL review; never a substitute for actual Blob readback.
SELECT jsonb_build_object(
 'ownerRole',current_user,
 'ownerSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
 'tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wjb_migration' AND c.relkind='r'),
 'rlsTables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wjb_migration' AND c.relkind='r' AND c.relrowsecurity),
 'binaryColumns',(SELECT count(*) FROM information_schema.columns WHERE table_schema='wjb_migration' AND data_type='bytea'),
 'functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='wjb_migration')+1,
 'unsafeSearchPaths',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE
   (n.nspname='wjb_migration' OR p.oid='public.wjb_v2_migration_command(jsonb)'::regprocedure) AND
   NOT ('search_path=pg_catalog'=ANY(coalesce(p.proconfig,'{}'::text[])))),
 'clientExecute',has_function_privilege('anon','public.wjb_v2_migration_command(jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.wjb_v2_migration_command(jsonb)','EXECUTE'),
 'serviceExecute',has_function_privilege('service_role','public.wjb_v2_migration_command(jsonb)','EXECUTE'),
 'serviceTableAccess',has_table_privilege('service_role','wjb_migration.job','SELECT,INSERT,UPDATE,DELETE'),
 'jobs',(SELECT count(*) FROM wjb_migration.job),
 'profile','migration-document-poc-1'
);
