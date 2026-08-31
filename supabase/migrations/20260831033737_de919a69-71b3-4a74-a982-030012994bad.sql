ALTER TABLE public.electrical_service_panels
  ADD COLUMN IF NOT EXISTS fed_from_kind TEXT,
  ADD COLUMN IF NOT EXISTS fed_from_panel_uuid UUID REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fed_from_panel_ref TEXT,
  ADD COLUMN IF NOT EXISTS panel_ampacity_amps NUMERIC;

CREATE INDEX IF NOT EXISTS electrical_service_panels_fed_from_idx
  ON public.electrical_service_panels (fed_from_panel_uuid);