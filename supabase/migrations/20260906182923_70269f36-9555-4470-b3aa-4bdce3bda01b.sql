ALTER TABLE public.site_buildings
  ADD COLUMN IF NOT EXISTS service_type text;

ALTER TABLE public.site_buildings
  DROP CONSTRAINT IF EXISTS site_buildings_service_type_check;

ALTER TABLE public.site_buildings
  ADD CONSTRAINT site_buildings_service_type_check
  CHECK (service_type IS NULL OR service_type IN ('ELECTRICITY','WATER','GAS','NONE'));