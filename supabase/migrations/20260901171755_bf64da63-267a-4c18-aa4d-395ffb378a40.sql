DROP FUNCTION IF EXISTS public.panel_edit_access(uuid, text);

CREATE OR REPLACE FUNCTION private.panel_edit_access(_user_id uuid, _panel_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.electrical_panel_edit_requests r
    WHERE r.requester_id = _user_id
      AND r.panel_id = _panel_id
      AND r.status = 'approved'
      AND r.revoked_at IS NULL
      AND r.expires_at IS NOT NULL
      AND r.expires_at > now()
  )
$$;

REVOKE ALL ON FUNCTION private.panel_edit_access(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.panel_edit_access(uuid, text) TO service_role;