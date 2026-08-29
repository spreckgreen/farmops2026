ALTER TABLE public.electrical_raceways
  ADD COLUMN IF NOT EXISTS route_group text,
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS service_type text,
  ADD COLUMN IF NOT EXISTS from_label text,
  ADD COLUMN IF NOT EXISTS to_label text;

ALTER TABLE public.electrical_loads
  ADD COLUMN IF NOT EXISTS source_circuit text;