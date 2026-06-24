CREATE OR REPLACE FUNCTION public.restore_table_diagnostics(_table text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT jsonb_build_object(
    'rls_enabled', (
      SELECT c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = _table
    ),
    'policies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'policyname', policyname,
        'cmd', cmd,
        'roles', roles,
        'qual', qual,
        'with_check', with_check
      ))
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = _table
    ), '[]'::jsonb),
    'grants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('grantee', grantee, 'privilege_type', privilege_type))
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = _table
        AND grantee IN ('anon', 'authenticated', 'service_role', 'postgres')
    ), '[]'::jsonb),
    'can_authenticated_insert',  has_table_privilege('authenticated', format('public.%I', _table), 'INSERT'),
    'can_authenticated_update',  has_table_privilege('authenticated', format('public.%I', _table), 'UPDATE'),
    'can_authenticated_delete',  has_table_privilege('authenticated', format('public.%I', _table), 'DELETE'),
    'can_authenticated_select',  has_table_privilege('authenticated', format('public.%I', _table), 'SELECT')
  ) INTO result;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.restore_table_diagnostics(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_table_diagnostics(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.restore_table_diagnostics(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_table_diagnostics(text) TO service_role;