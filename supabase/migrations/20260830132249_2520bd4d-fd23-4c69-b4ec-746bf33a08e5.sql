ALTER TABLE public.electrical_loads
  ADD COLUMN IF NOT EXISTS equipment_model text,
  ADD COLUMN IF NOT EXISTS source_reference text,
  ADD COLUMN IF NOT EXISTS suggested_panel text,
  ADD COLUMN IF NOT EXISTS dedicated_shared text;

COMMENT ON COLUMN public.electrical_loads.equipment_model IS 'Canonical ODS Equipment / Model text (engineering design authority).';
COMMENT ON COLUMN public.electrical_loads.source_reference IS 'Canonical ODS Source / Reference text (engineering design authority).';
COMMENT ON COLUMN public.electrical_loads.suggested_panel IS 'Canonical ODS Suggested Panel text for this load (engineering design authority).';
COMMENT ON COLUMN public.electrical_loads.dedicated_shared IS 'Canonical ODS D/S column: Dedicated / Shared / TBD tri-state text; never coerced to a boolean.';