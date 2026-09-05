CREATE TABLE public.site_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  site_name text NOT NULL,
  address text NOT NULL,
  formatted_address text,
  latitude double precision,
  longitude double precision,
  imagery_source text NOT NULL DEFAULT 'google_satellite',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_plans TO authenticated;
GRANT ALL ON public.site_plans TO service_role;
ALTER TABLE public.site_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_plans_select_own" ON public.site_plans FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "site_plans_insert_own" ON public.site_plans FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "site_plans_update_own" ON public.site_plans FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "site_plans_delete_own" ON public.site_plans FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.site_buildings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_plan_id uuid NOT NULL REFERENCES public.site_plans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  temp_name text NOT NULL,
  size_rank integer NOT NULL DEFAULT 1,
  outline jsonb NOT NULL,
  origin_latitude double precision,
  origin_longitude double precision,
  footprint_sqft numeric(12,2),
  perimeter_ft numeric(12,2),
  fit_length_ft numeric(10,2),
  fit_width_ft numeric(10,2),
  orientation_degrees numeric(6,2),
  grid_cell_ft numeric(6,2) NOT NULL DEFAULT 8,
  grid_rows integer,
  grid_columns integer,
  grid_row_labels text,
  grid_column_labels text,
  mapped_structure text,
  mapped_confidence text,
  trace_method text NOT NULL DEFAULT 'TRACED_CORNERS',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_plan_id, temp_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_buildings TO authenticated;
GRANT ALL ON public.site_buildings TO service_role;
ALTER TABLE public.site_buildings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_buildings_select_own" ON public.site_buildings FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.site_plans p WHERE p.id = site_plan_id AND p.user_id = auth.uid()));
CREATE POLICY "site_buildings_insert_own" ON public.site_buildings FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.site_plans p WHERE p.id = site_plan_id AND p.user_id = auth.uid()));
CREATE POLICY "site_buildings_update_own" ON public.site_buildings FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.site_plans p WHERE p.id = site_plan_id AND p.user_id = auth.uid()))
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.site_plans p WHERE p.id = site_plan_id AND p.user_id = auth.uid()));
CREATE POLICY "site_buildings_delete_own" ON public.site_buildings FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.site_plans p WHERE p.id = site_plan_id AND p.user_id = auth.uid()));

CREATE TRIGGER site_plans_set_updated_at BEFORE UPDATE ON public.site_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER site_buildings_set_updated_at BEFORE UPDATE ON public.site_buildings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX site_buildings_plan_idx ON public.site_buildings (site_plan_id, size_rank);