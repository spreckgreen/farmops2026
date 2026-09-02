ALTER TABLE public.electrical_loads
  ADD COLUMN IF NOT EXISTS nameplate_manufacturer text,
  ADD COLUMN IF NOT EXISTS nameplate_model text,
  ADD COLUMN IF NOT EXISTS nameplate_serial text,
  ADD COLUMN IF NOT EXISTS nameplate_volts text,
  ADD COLUMN IF NOT EXISTS nameplate_phase text,
  ADD COLUMN IF NOT EXISTS nameplate_fla_rla text,
  ADD COLUMN IF NOT EXISTS nameplate_mca text,
  ADD COLUMN IF NOT EXISTS nameplate_mocp text,
  ADD COLUMN IF NOT EXISTS nameplate_source text,
  ADD COLUMN IF NOT EXISTS nameplate_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS nameplate_applied_by uuid;

CREATE TABLE public.electrical_nameplate_write_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL,
  load_uuid uuid NOT NULL REFERENCES public.electrical_loads(id) ON DELETE CASCADE,
  load_ref text,
  load_label text,
  proposed jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_note text,
  status public.approval_status NOT NULL DEFAULT 'pending',
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  applied_at timestamptz,
  applied_fields jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_nameplate_write_requests TO authenticated;
GRANT ALL ON public.electrical_nameplate_write_requests TO service_role;

ALTER TABLE public.electrical_nameplate_write_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own nameplate requests select"
  ON public.electrical_nameplate_write_requests FOR SELECT TO authenticated
  USING (auth.uid() = requested_by OR private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Own nameplate requests insert"
  ON public.electrical_nameplate_write_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = requested_by AND status = 'pending');

CREATE POLICY "Admin nameplate requests update"
  ON public.electrical_nameplate_write_requests FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admin nameplate requests delete"
  ON public.electrical_nameplate_write_requests FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX electrical_nameplate_write_requests_status_idx
  ON public.electrical_nameplate_write_requests (status, created_at DESC);
CREATE INDEX electrical_nameplate_write_requests_requester_idx
  ON public.electrical_nameplate_write_requests (requested_by, created_at DESC);

CREATE TRIGGER electrical_nameplate_write_requests_updated_at
  BEFORE UPDATE ON public.electrical_nameplate_write_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();