CREATE TABLE public.building_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_building_id uuid NOT NULL REFERENCES public.site_buildings(id) ON DELETE CASCADE,
  area_name text NOT NULL,
  area_kind text NOT NULL DEFAULT 'ROOM',
  floor_level text,
  grid_cells text,
  start_cell text,
  end_cell text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT building_areas_kind_check CHECK (area_kind IN ('ROOM','AREA','BAY','EXTERIOR','MECHANICAL','STORAGE','OTHER')),
  CONSTRAINT building_areas_name_unique UNIQUE (site_building_id, area_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.building_areas TO authenticated;
GRANT ALL ON public.building_areas TO service_role;
ALTER TABLE public.building_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their building areas" ON public.building_areas
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Owners insert their building areas" ON public.building_areas
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.site_buildings b WHERE b.id = site_building_id AND b.user_id = auth.uid())
  );
CREATE POLICY "Owners update their building areas" ON public.building_areas
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Owners delete their building areas" ON public.building_areas
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX building_areas_building_idx ON public.building_areas (site_building_id);

CREATE TRIGGER building_areas_set_updated_at BEFORE UPDATE ON public.building_areas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.building_area_circuits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  building_area_id uuid NOT NULL REFERENCES public.building_areas(id) ON DELETE CASCADE,
  circuit_group_uuid uuid REFERENCES public.electrical_circuit_groups(id) ON DELETE SET NULL,
  circuit_group_ref text,
  panel_ref text,
  breaker_number integer,
  load_ref text,
  assignment_basis text NOT NULL DEFAULT 'DESIGN',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT building_area_circuits_basis_check CHECK (assignment_basis IN ('DESIGN','FIELD_OBSERVED')),
  CONSTRAINT building_area_circuits_breaker_check CHECK (breaker_number IS NULL OR breaker_number BETWEEN 1 AND 200)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.building_area_circuits TO authenticated;
GRANT ALL ON public.building_area_circuits TO service_role;
ALTER TABLE public.building_area_circuits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their area circuits" ON public.building_area_circuits
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Owners insert their area circuits" ON public.building_area_circuits
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.building_areas a WHERE a.id = building_area_id AND a.user_id = auth.uid())
  );
CREATE POLICY "Owners update their area circuits" ON public.building_area_circuits
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Owners delete their area circuits" ON public.building_area_circuits
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX building_area_circuits_area_idx ON public.building_area_circuits (building_area_id);

CREATE TRIGGER building_area_circuits_set_updated_at BEFORE UPDATE ON public.building_area_circuits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();