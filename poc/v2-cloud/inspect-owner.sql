-- Read-only capability inspection. This does not SET ROLE or test write credentials.
SELECT jsonb_build_object(
 'inspection_role',current_user,
 'candidate_role','postgres',
 'candidate',(SELECT jsonb_build_object('exists',true,'superuser',rolsuper,'bypassRls',rolbypassrls,'canLogin',rolcanlogin,'inherits',rolinherit) FROM pg_roles WHERE rolname='postgres'),
 'create_schema',has_database_privilege('postgres',current_database(),'CREATE'),
 'public_create',has_schema_privilege('postgres','public','CREATE'),
 'public_usage',has_schema_privilege('postgres','public','USAGE'),
 'auth_usage',has_schema_privilege('postgres','auth','USAGE'),
 'plpgsql_usage',has_language_privilege('postgres','plpgsql','USAGE'),
 'auth_columns',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,
   'select',has_column_privilege('postgres',c.oid,a.attname,'SELECT')) ORDER BY c.relname,a.attname)
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='auth' AND a.attnum>0 AND NOT a.attisdropped AND (c.relname,a.attname) IN
  (('sessions','id'),('sessions','user_id'),('sessions','not_after'),('users','id'),('users','banned_until'),('users','deleted_at'))),
 'auth_rls',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'enabled',c.relrowsecurity,'forced',c.relforcerowsecurity,
   'owner',pg_get_userbyid(c.relowner),'candidateHasOwnerPrivileges',pg_has_role('postgres',c.relowner,'USAGE')) ORDER BY c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname IN ('users','sessions')),
 'api_roles',(SELECT jsonb_agg(jsonb_build_object('role',rolname,'superuser',rolsuper,'bypassRls',rolbypassrls,
   'publicCreate',has_schema_privilege(rolname,'public','CREATE')) ORDER BY rolname)
  FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')),
 'physical_database_bytes',pg_database_size(current_database()),
 'postgres_version',current_setting('server_version')
) AS owner_inspection;
