ALTER TABLE public.electrical_panels
  ADD COLUMN IF NOT EXISTS utility_service_uuid uuid NULL REFERENCES public.electrical_services(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS electrical_panels_utility_service_uuid_idx
  ON public.electrical_panels (utility_service_uuid);