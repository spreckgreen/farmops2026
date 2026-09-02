ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_by uuid,
  ADD COLUMN IF NOT EXISTS disabled_reason text;

ALTER TABLE public.electrical_panel_edit_requests
  DROP CONSTRAINT IF EXISTS electrical_panel_edit_requests_scope_check;
ALTER TABLE public.electrical_panel_edit_requests
  ADD CONSTRAINT electrical_panel_edit_requests_scope_check
  CHECK (scope = ANY (ARRAY['panel_edit'::text, 'system_data'::text, 'building_data'::text, 'site_data'::text]));
ALTER TABLE public.electrical_panel_edit_requests
  ADD COLUMN IF NOT EXISTS scope_detail text;

CREATE TABLE IF NOT EXISTS public.electrical_scan_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  panel_id text NOT NULL,
  first_scanned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, panel_id)
);

GRANT SELECT ON public.electrical_scan_grants TO authenticated;
GRANT ALL ON public.electrical_scan_grants TO service_role;

ALTER TABLE public.electrical_scan_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own scanned panels"
  ON public.electrical_scan_grants FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins read all scanned panels"
  ON public.electrical_scan_grants FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER electrical_scan_grants_set_updated_at
  BEFORE UPDATE ON public.electrical_scan_grants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS electrical_scan_grants_user_idx
  ON public.electrical_scan_grants (user_id);