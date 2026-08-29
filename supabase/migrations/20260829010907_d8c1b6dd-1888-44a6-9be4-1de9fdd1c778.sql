DROP FUNCTION IF EXISTS public.has_addon(uuid, text);

CREATE OR REPLACE FUNCTION private.has_addon(_user_id uuid, _addon_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_entitlements e
    JOIN public.app_addons a ON a.key = e.addon_key
    WHERE e.user_id = _user_id
      AND e.addon_key = _addon_key
      AND a.active
      AND e.status IN ('active', 'trialing')
      AND (e.expires_at IS NULL OR e.expires_at > now())
  )
$$;

REVOKE ALL ON FUNCTION private.has_addon(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_addon(uuid, text) TO service_role;