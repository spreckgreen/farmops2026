CREATE TABLE public.electrical_panel_edit_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  panel_id text NOT NULL,
  requester_id uuid NOT NULL DEFAULT auth.uid(),
  requester_email text,
  reason text,
  status public.approval_status NOT NULL DEFAULT 'pending',
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX electrical_panel_edit_requests_panel_idx
  ON public.electrical_panel_edit_requests (panel_id, requester_id, status);
CREATE INDEX electrical_panel_edit_requests_pending_idx
  ON public.electrical_panel_edit_requests (status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_panel_edit_requests TO authenticated;
GRANT ALL ON public.electrical_panel_edit_requests TO service_role;

ALTER TABLE public.electrical_panel_edit_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requesters and admins read edit requests"
  ON public.electrical_panel_edit_requests FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Requesters create their own edit requests"
  ON public.electrical_panel_edit_requests FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid() AND status = 'pending');

CREATE POLICY "Admins decide edit requests"
  ON public.electrical_panel_edit_requests FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete edit requests"
  ON public.electrical_panel_edit_requests FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

CREATE TRIGGER electrical_panel_edit_requests_updated_at
  BEFORE UPDATE ON public.electrical_panel_edit_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.panel_edit_access(_user_id uuid, _panel_id text)
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

REVOKE ALL ON FUNCTION public.panel_edit_access(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.panel_edit_access(uuid, text) TO authenticated, service_role;