-- Read-only checks for the v24 label migration.
SELECT jsonb_build_object(
 'camelCaseLabels', (
  SELECT bool_and(wjb_migration.workspace_label(jsonb_build_object('value',
    jsonb_build_object('workspace',jsonb_build_object('name','Synthetic','color','c3','icon',icon))::text))
    = jsonb_build_object('name','Synthetic','color','c3','icon',icon))
  FROM unnest(ARRAY['chartUp','chartBar','cardIndex','moneyBag','creditCard']) AS allowed(icon)
 ),
 'unknownIconRejected', wjb_migration.workspace_label(jsonb_build_object('value',
   jsonb_build_object('workspace',jsonb_build_object('name','Synthetic','color','c3','icon','unknown'))::text)) IS NULL,
 'publishedFallback', position('coalesce(wjb_migration.workspace_label(sv.value)' IN
   pg_get_functiondef('public.wjb_v2_workspace_read(jsonb)'::regprocedure))>0,
 'serviceOnly', has_function_privilege('service_role','public.wjb_v2_workspace_read(jsonb)','EXECUTE')
   AND NOT has_function_privilege('anon','public.wjb_v2_workspace_read(jsonb)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public.wjb_v2_workspace_read(jsonb)','EXECUTE')
) AS the_check;
