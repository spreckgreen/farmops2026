
-- rachio_controllers
CREATE TABLE public.rachio_controllers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rachio_id text NOT NULL,
  name text,
  model text,
  serial_number text,
  status text,
  last_synced_at timestamptz,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, rachio_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rachio_controllers TO authenticated;
GRANT ALL ON public.rachio_controllers TO service_role;
ALTER TABLE public.rachio_controllers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rachio_controllers owner all" ON public.rachio_controllers
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_rachio_controllers_updated
  BEFORE UPDATE ON public.rachio_controllers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- rachio_zones
CREATE TABLE public.rachio_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  controller_id uuid NOT NULL REFERENCES public.rachio_controllers(id) ON DELETE CASCADE,
  rachio_id text NOT NULL,
  zone_number integer,
  name text,
  enabled boolean DEFAULT true,
  nozzle text,
  area_sqft numeric,
  garden_plot_id uuid REFERENCES public.garden_plots(id) ON DELETE SET NULL,
  orchard_tree_id uuid REFERENCES public.orchard_trees(id) ON DELETE SET NULL,
  last_run_at timestamptz,
  next_run_at timestamptz,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, rachio_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rachio_zones TO authenticated;
GRANT ALL ON public.rachio_zones TO service_role;
ALTER TABLE public.rachio_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rachio_zones owner all" ON public.rachio_zones
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_rachio_zones_garden ON public.rachio_zones(garden_plot_id);
CREATE INDEX idx_rachio_zones_orchard ON public.rachio_zones(orchard_tree_id);
CREATE TRIGGER trg_rachio_zones_updated
  BEFORE UPDATE ON public.rachio_zones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- rachio_runs
CREATE TABLE public.rachio_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  zone_id uuid NOT NULL REFERENCES public.rachio_zones(id) ON DELETE CASCADE,
  rachio_event_id text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_seconds integer,
  gallons numeric,
  source text,
  status text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, rachio_event_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rachio_runs TO authenticated;
GRANT ALL ON public.rachio_runs TO service_role;
ALTER TABLE public.rachio_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rachio_runs owner all" ON public.rachio_runs
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_rachio_runs_zone_started ON public.rachio_runs(zone_id, started_at DESC);
CREATE TRIGGER trg_rachio_runs_updated
  BEFORE UPDATE ON public.rachio_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- rachio_webhook_events (admin audit)
CREATE TABLE public.rachio_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  signature_ok boolean NOT NULL,
  event_type text,
  external_id text,
  payload jsonb,
  processed_at timestamptz,
  error text
);
GRANT ALL ON public.rachio_webhook_events TO service_role;
ALTER TABLE public.rachio_webhook_events ENABLE ROW LEVEL SECURITY;
-- No authenticated policy: webhook audit is service-role only.
