-- Revoke EXECUTE on SECURITY DEFINER functions from PUBLIC and anon.
-- These are intended only for use by RLS policies (running as authenticated users)
-- or as trigger functions (which don't need EXECUTE grants).

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.can_write(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_approved(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_approved(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.log_food_price_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_food_price_change() TO service_role;
