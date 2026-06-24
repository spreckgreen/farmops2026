CREATE OR REPLACE FUNCTION public.restore_table_diagnostics(_table text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
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
$$;

GRANT EXECUTE ON FUNCTION public.restore_table_diagnostics(text) TO authenticated;