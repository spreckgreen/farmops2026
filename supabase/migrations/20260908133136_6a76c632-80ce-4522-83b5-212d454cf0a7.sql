DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['electrical_panels','electrical_junction_boxes','electrical_raceways','electrical_loads','electrical_switch_banks','electrical_switch_devices','electrical_circuit_groups']
  LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS measured_xy_method text,
      ADD COLUMN IF NOT EXISTS measured_xy_accuracy_ft numeric,
      ADD COLUMN IF NOT EXISTS measured_xy_datum text,
      ADD COLUMN IF NOT EXISTS measured_xy_at timestamptz,
      ADD COLUMN IF NOT EXISTS measured_xy_by text', t);
    EXECUTE format('ALTER TABLE public.%I
      ADD CONSTRAINT %I CHECK (measured_xy_method IS NULL OR measured_xy_method IN (''TAPE'',''LASER'',''GPS_RTK'',''GPS_HANDHELD'',''TOTAL_STATION'',''OTHER''))', t, t || '_measured_xy_method_chk');
  END LOOP;
END $$;