DROP FUNCTION IF EXISTS public.schema_diagnostics();

CREATE OR REPLACE FUNCTION private.schema_diagnostics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  required_tables text[] := ARRAY[
    'activity_log','consumables','crop_harvests','crop_plantings','daily_notes',
    'food_plan_entries','food_plan_foods','food_plan_people','food_price_history',
    'food_storage_items','food_storage_plan','garden_plots','inventory_items',
    'livestock_animals','maintenance_records','orchard_trees','plant_seasons',
    'procedure_links','procedures','profiles','project_design_elements','projects',
    'rachio_controllers','rachio_runs','rachio_webhook_events','rachio_zones',
    'summaries','tasks','user_roles','vault_key_export_audit',
    'vault_key_wrap_credentials','vault_secrets','weather_forecasts','webauthn_challenges'
  ];
  required_enums text[] := ARRAY[
    'app_role','approval_status','entry_type','summary_mode','summary_status','task_status'
  ];
  required_triggers text[][] := ARRAY[
    ['tasks','tasks_set_updated_at'],
    ['daily_notes','daily_notes_set_updated_at'],
    ['summaries','summaries_set_updated_at'],
    ['projects','projects_set_updated_at'],
    ['maintenance_records','maintenance_records_set_updated_at'],
    ['inventory_items','inventory_items_set_updated_at'],
    ['profiles','profiles_updated_at'],
    ['vault_secrets','vault_secrets_set_updated_at'],
    ['food_plan_foods','food_plan_foods_price_history'],
    ['procedure_links','procedure_links_set_updated_at']
  ];
  tables_report jsonb;
  enums_report jsonb;
  triggers_report jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'table', t,
      'present', c.relname IS NOT NULL,
      'rls_enabled', COALESCE(c.relrowsecurity, false),
      'policy_count', COALESCE((
        SELECT count(*) FROM pg_policies p
        WHERE p.schemaname='public' AND p.tablename=t
      ), 0)
    ) ORDER BY t
  )
  INTO tables_report
  FROM unnest(required_tables) t
  LEFT JOIN pg_class c
    ON c.relname = t
   AND c.relnamespace = 'public'::regnamespace
   AND c.relkind = 'r';

  SELECT jsonb_agg(
    jsonb_build_object(
      'type', e,
      'present', typ.typname IS NOT NULL,
      'labels', COALESCE((
        SELECT array_agg(enumlabel ORDER BY enumsortorder)
        FROM pg_enum WHERE enumtypid = typ.oid
      ), ARRAY[]::text[])
    ) ORDER BY e
  )
  INTO enums_report
  FROM unnest(required_enums) e
  LEFT JOIN pg_type typ
    ON typ.typname = e
   AND typ.typnamespace = 'public'::regnamespace;

  SELECT jsonb_agg(
    jsonb_build_object(
      'table', req[1],
      'trigger', req[2],
      'present', tg.tgname IS NOT NULL
    ) ORDER BY req[1], req[2]
  )
  INTO triggers_report
  FROM (
    SELECT ARRAY[required_triggers[i][1], required_triggers[i][2]] AS req
    FROM generate_subscripts(required_triggers, 1) AS i
  ) s
  LEFT JOIN pg_trigger tg
    ON tg.tgname = req[2]
   AND NOT tg.tgisinternal
   AND tg.tgrelid = ('public.' || quote_ident(req[1]))::regclass;

  RETURN jsonb_build_object(
    'checked_at', now(),
    'tables', COALESCE(tables_report, '[]'::jsonb),
    'enums', COALESCE(enums_report, '[]'::jsonb),
    'triggers', COALESCE(triggers_report, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION private.schema_diagnostics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.schema_diagnostics() TO service_role;