-- Lock down trigger-only SECURITY DEFINER functions so they are not callable
-- via PostgREST by anon/authenticated. They only need to run from triggers
-- (which execute as the table owner), so revoking EXECUTE eliminates the
-- "signed-in users can execute SECURITY DEFINER function" exposure.
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_inventory_status() FROM PUBLIC, anon, authenticated;

-- has_role(uuid, app_role) and can_write(uuid) are intentionally callable by
-- authenticated users: they are used inside RLS USING/WITH CHECK clauses and
-- evaluated as the caller. Revoking EXECUTE would break every policy that
-- relies on them. Restrict anon (which should never need them) and keep
-- authenticated/service_role access.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_write(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write(uuid) TO authenticated, service_role;