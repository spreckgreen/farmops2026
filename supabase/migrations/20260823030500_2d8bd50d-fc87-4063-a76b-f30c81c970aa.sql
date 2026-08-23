-- Fix anonymous "permission denied for schema private" errors.
-- The private helper functions are SECURITY DEFINER and safely return false
-- for anonymous users (auth.uid() is null), but anon still needs schema USAGE
-- and EXECUTE so PostgREST can evaluate RLS policies that reference them.
GRANT USAGE ON SCHEMA private TO anon;

GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO anon;
GRANT EXECUTE ON FUNCTION private.can_write(uuid) TO anon;
GRANT EXECUTE ON FUNCTION private.is_approved(uuid) TO anon;
