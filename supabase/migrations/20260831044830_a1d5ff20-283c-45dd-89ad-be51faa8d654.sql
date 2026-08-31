CREATE TABLE public.electrical_field_observations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  workbook TEXT NOT NULL,
  worksheet TEXT,
  source_row INTEGER,
  source_column TEXT,
  source_photo TEXT,
  panel_ref TEXT,
  panel_uuid UUID REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  positions_text TEXT,
  side TEXT,
  position INTEGER,
  poles INTEGER,
  field TEXT NOT NULL,
  observed_text TEXT NOT NULL,
  interpreted_value TEXT,
  confidence TEXT,
  canonical_value TEXT,
  farmops_value TEXT,
  classification TEXT,
  proposed_action TEXT,
  disposition TEXT NOT NULL DEFAULT 'observed',
  verification_status TEXT,
  notes TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX electrical_field_obs_panel_idx
  ON public.electrical_field_observations (user_id, panel_ref, side, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_field_observations TO authenticated;
GRANT ALL ON public.electrical_field_observations TO service_role;
ALTER TABLE public.electrical_field_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "field_obs_select_own" ON public.electrical_field_observations FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "field_obs_insert_own" ON public.electrical_field_observations FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "field_obs_update_own" ON public.electrical_field_observations FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "field_obs_delete_own" ON public.electrical_field_observations FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER electrical_field_observations_set_updated_at BEFORE UPDATE ON public.electrical_field_observations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();