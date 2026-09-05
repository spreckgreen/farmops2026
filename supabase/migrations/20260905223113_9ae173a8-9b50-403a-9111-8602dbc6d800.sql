CREATE TABLE public.building_levels (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  site_building_id uuid NOT NULL REFERENCES public.site_buildings(id) ON DELETE CASCADE,
  level_stable_id text NOT NULL,
  display_name text NOT NULL,
  short_code text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  elevation_ft numeric,
  grid_rows integer,
  grid_columns integer,
  grid_cell_ft numeric,
  grid_scheme_uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  lifecycle_state text NOT NULL DEFAULT 'planned',
  evidence_ref text,
  evidence_observed_at timestamp with time zone,
  is_default boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX building_levels_stable_id_key ON public.building_levels (user_id, level_stable_id);
CREATE UNIQUE INDEX building_levels_short_code_key ON public.building_levels (site_building_id, upper(short_code));
CREATE UNIQUE INDEX building_levels_scheme_key ON public.building_levels (grid_scheme_uuid);
CREATE INDEX building_levels_building_idx ON public.building_levels (site_building_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.building_levels TO authenticated;
GRANT ALL ON public.building_levels TO service_role;
ALTER TABLE public.building_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "building_levels_select_own" ON public.building_levels FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "building_levels_insert_own" ON public.building_levels FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "building_levels_update_own" ON public.building_levels FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "building_levels_delete_own" ON public.building_levels FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER building_levels_set_updated_at BEFORE UPDATE ON public.building_levels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.building_level_grid_refs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  site_building_id uuid NOT NULL REFERENCES public.site_buildings(id) ON DELETE CASCADE,
  building_level_uuid uuid NOT NULL REFERENCES public.building_levels(id) ON DELETE CASCADE,
  grid_scheme_uuid uuid NOT NULL,
  grid_reference text NOT NULL,
  x_ft numeric,
  y_ft numeric,
  z_ft numeric,
  location_source text,
  location_precision text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX building_level_grid_refs_scope_key ON public.building_level_grid_refs
  (site_building_id, building_level_uuid, grid_scheme_uuid, upper(grid_reference));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.building_level_grid_refs TO authenticated;
GRANT ALL ON public.building_level_grid_refs TO service_role;
ALTER TABLE public.building_level_grid_refs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "building_level_grid_refs_select_own" ON public.building_level_grid_refs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "building_level_grid_refs_insert_own" ON public.building_level_grid_refs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "building_level_grid_refs_update_own" ON public.building_level_grid_refs FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "building_level_grid_refs_delete_own" ON public.building_level_grid_refs FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER building_level_grid_refs_set_updated_at BEFORE UPDATE ON public.building_level_grid_refs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'electrical_panels','electrical_junction_boxes','electrical_loads','electrical_devices',
    'electrical_power_assets','electrical_racks','electrical_switch_banks','electrical_switch_devices',
    'electrical_field_observations','electrical_raceway_waypoints','cameras','building_areas',
    'electrical_circuit_groups'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS site_building_uuid uuid REFERENCES public.site_buildings(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS building_level_uuid uuid REFERENCES public.building_levels(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS grid_scheme_uuid uuid,
      ADD COLUMN IF NOT EXISTS level_grid_reference text,
      ADD COLUMN IF NOT EXISTS location_x_ft numeric,
      ADD COLUMN IF NOT EXISTS location_y_ft numeric,
      ADD COLUMN IF NOT EXISTS location_z_ft numeric,
      ADD COLUMN IF NOT EXISTS location_source text,
      ADD COLUMN IF NOT EXISTS location_precision text', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (building_level_uuid)', t || '_level_idx', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'electrical_raceways','electrical_feeders','electrical_branch_runs','electrical_control_wiring_segments'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS source_building_level_uuid uuid REFERENCES public.building_levels(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS dest_building_level_uuid uuid REFERENCES public.building_levels(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS source_level_grid_reference text,
      ADD COLUMN IF NOT EXISTS dest_level_grid_reference text,
      ADD COLUMN IF NOT EXISTS is_vertical_riser boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS vertical_run_kind text,
      ADD COLUMN IF NOT EXISTS vertical_rise_ft numeric', t);
  END LOOP;
END $$;