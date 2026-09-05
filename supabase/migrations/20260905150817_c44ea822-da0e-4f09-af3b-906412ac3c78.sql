ALTER TABLE public.site_plans ALTER COLUMN address DROP NOT NULL;

ALTER TABLE public.site_buildings
  ADD COLUMN IF NOT EXISTS building_name text,
  ADD COLUMN IF NOT EXISTS definition_method text,
  ADD COLUMN IF NOT EXISTS shape_template text,
  ADD COLUMN IF NOT EXISTS height_ft numeric,
  ADD COLUMN IF NOT EXISTS outline_local jsonb,
  ADD COLUMN IF NOT EXISTS north_offset_degrees numeric,
  ADD COLUMN IF NOT EXISTS walk_start_cell text,
  ADD COLUMN IF NOT EXISTS walk_finish_cell text,
  ADD COLUMN IF NOT EXISTS walk_pattern text,
  ADD COLUMN IF NOT EXISTS source_file_name text,
  ADD COLUMN IF NOT EXISTS source_scale_note text;

ALTER TABLE public.site_buildings
  ADD CONSTRAINT site_buildings_definition_method_check
  CHECK (definition_method IS NULL OR definition_method IN (
    'TRACED_IMAGERY','ENTERED_DIMENSIONS','STANDARD_SHAPE','CORNER_LIST','SVG_IMPORT','DXF_IMPORT','TRACED_PDF'
  ));

ALTER TABLE public.site_buildings
  ADD CONSTRAINT site_buildings_walk_pattern_check
  CHECK (walk_pattern IS NULL OR walk_pattern IN ('CLOCKWISE','COUNTERCLOCKWISE','SERPENTINE_ROWS','ROW_MAJOR'));