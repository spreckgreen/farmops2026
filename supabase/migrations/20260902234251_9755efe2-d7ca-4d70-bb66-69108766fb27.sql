ALTER TABLE public.electrical_loads
  ADD COLUMN IF NOT EXISTS location_x_ft numeric,
  ADD COLUMN IF NOT EXISTS location_y_ft numeric,
  ADD COLUMN IF NOT EXISTS grid_reference text,
  ADD COLUMN IF NOT EXISTS grid_reference_precision text,
  ADD COLUMN IF NOT EXISTS grid_migration_provenance text,
  ADD COLUMN IF NOT EXISTS legacy_grid text;

ALTER TABLE public.electrical_panels
  ADD COLUMN IF NOT EXISTS location_x_ft numeric,
  ADD COLUMN IF NOT EXISTS location_y_ft numeric,
  ADD COLUMN IF NOT EXISTS grid_reference text,
  ADD COLUMN IF NOT EXISTS grid_reference_precision text,
  ADD COLUMN IF NOT EXISTS grid_migration_provenance text,
  ADD COLUMN IF NOT EXISTS legacy_grid text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'electrical_loads_grid_precision_chk'
  ) THEN
    ALTER TABLE public.electrical_loads
      ADD CONSTRAINT electrical_loads_grid_precision_chk
      CHECK (grid_reference_precision IS NULL OR grid_reference_precision IN ('EXACT','NEAREST','INTERVAL','NON_FIXED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'electrical_panels_grid_precision_chk'
  ) THEN
    ALTER TABLE public.electrical_panels
      ADD CONSTRAINT electrical_panels_grid_precision_chk
      CHECK (grid_reference_precision IS NULL OR grid_reference_precision IN ('EXACT','NEAREST','INTERVAL','NON_FIXED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'electrical_loads_non_fixed_no_xy_chk'
  ) THEN
    ALTER TABLE public.electrical_loads
      ADD CONSTRAINT electrical_loads_non_fixed_no_xy_chk
      CHECK (grid_reference_precision <> 'NON_FIXED' OR (location_x_ft IS NULL AND location_y_ft IS NULL AND grid_reference IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'electrical_panels_non_fixed_no_xy_chk'
  ) THEN
    ALTER TABLE public.electrical_panels
      ADD CONSTRAINT electrical_panels_non_fixed_no_xy_chk
      CHECK (grid_reference_precision <> 'NON_FIXED' OR (location_x_ft IS NULL AND location_y_ft IS NULL AND grid_reference IS NULL));
  END IF;
END $$;