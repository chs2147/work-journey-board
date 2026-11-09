-- SELECT only. Review the selected DEV ref/role separately before any apply.
SELECT jsonb_build_object(
 'ownerRole',current_user,
 'sessionGuard',to_regprocedure('public.wjb_v2_session_active(uuid,uuid)') IS NOT NULL,
 'assetCommand',to_regprocedure('public.wjb_v2_asset_command(jsonb)') IS NOT NULL,
 'schemaCollision',to_regnamespace('wjb_migration') IS NOT NULL,
 'rpcCollision',to_regprocedure('public.wjb_v2_migration_command(jsonb)') IS NOT NULL,
 'triggerCollision',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='wjb_gateway.asset'::regclass AND tgname='wjb_migration_asset_gate'),
 'profile','migration-document-poc-1',
 'autoApply',false
);
