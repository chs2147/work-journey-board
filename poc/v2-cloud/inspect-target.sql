-- READ-ONLY operator inspection. Review target dashboard/connection ref first.
-- Does not select user/session rows, secrets, database bodies or other buckets.
SELECT current_user AS prospective_migration_owner, r.rolsuper, r.rolbypassrls
FROM pg_roles r WHERE r.rolname=current_user;
SELECT c.table_name,c.column_name,c.data_type FROM information_schema.columns c
WHERE c.table_schema='auth' AND (c.table_name,c.column_name) IN (
 ('sessions','id'),('sessions','user_id'),('sessions','not_after'),
 ('users','id'),('users','banned_until'),('users','deleted_at'))
ORDER BY c.table_name,c.column_name;
SELECT to_regnamespace('wjb_v2_cloud') IS NOT NULL AS candidate_schema_already_exists,
 to_regprocedure('public.wjb_v2_session_active(uuid,uuid)') IS NOT NULL AS guard_rpc_already_exists,
 to_regprocedure('public.wjb_v2_revoke_session(uuid,uuid)') IS NOT NULL AS revoke_rpc_already_exists;
SELECT id,public,file_size_limit FROM storage.buckets WHERE id='wjb-v2-poc-private';
