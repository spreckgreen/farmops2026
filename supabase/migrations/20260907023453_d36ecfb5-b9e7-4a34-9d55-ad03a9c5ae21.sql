ALTER TABLE public.electrical_junction_boxes ADD COLUMN IF NOT EXISTS location_evidence text;
ALTER TABLE public.electrical_branch_runs ADD COLUMN IF NOT EXISTS location_evidence text;
ALTER TABLE public.electrical_raceways ADD COLUMN IF NOT EXISTS location_evidence text;