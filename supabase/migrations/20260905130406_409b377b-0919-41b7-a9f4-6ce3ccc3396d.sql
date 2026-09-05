ALTER TABLE public.electrical_loads
  ADD COLUMN IF NOT EXISTS design_location_source text,
  ADD COLUMN IF NOT EXISTS corner_reference text,
  ADD COLUMN IF NOT EXISTS mounting_wall_face text,
  ADD COLUMN IF NOT EXISTS coverage_direction text,
  ADD COLUMN IF NOT EXISTS mounting_classification text,
  ADD COLUMN IF NOT EXISTS mounting_height_ft numeric,
  ADD COLUMN IF NOT EXISTS resilience_class text,
  ADD COLUMN IF NOT EXISTS load_shed_capable boolean;

COMMENT ON COLUMN public.electrical_loads.design_location_source IS 'Canonical approved-design location source code, e.g. APPROVED_DESIGN_CORNER_FACE or APPROVED_DESIGN_XY. Planned design only; never field evidence.';
COMMENT ON COLUMN public.electrical_loads.corner_reference IS 'Building corner the planned design shares, e.g. NE/SE/SW/NW.';
COMMENT ON COLUMN public.electrical_loads.mounting_wall_face IS 'Wall face the device is mounted on: north/east/south/west.';
COMMENT ON COLUMN public.electrical_loads.coverage_direction IS 'Direction the device faces/covers; planned design intent.';
COMMENT ON COLUMN public.electrical_loads.mounting_classification IS 'Mounting classification, e.g. EXTERIOR_WALL_MOUNT.';
COMMENT ON COLUMN public.electrical_loads.mounting_height_ft IS 'Planned mounting height above finished grade/floor, in feet.';
COMMENT ON COLUMN public.electrical_loads.resilience_class IS 'Logical resilience/critical grouping (e.g. CRITICAL_CAMERA_GROUP). Never a physical panelboard.';
COMMENT ON COLUMN public.electrical_loads.load_shed_capable IS 'Whether load shedding is planned/enabled for this load. Logical capability, not a breaker.';