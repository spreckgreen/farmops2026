CREATE TABLE public.electrical_feeders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  feeder_id text NOT NULL,
  description text,
  source_panel_uuid uuid REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  source_endpoint_type text,
  source_endpoint_ref text,
  dest_panel_uuid uuid REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  dest_endpoint_type text,
  dest_endpoint_ref text,
  raceway_uuid uuid REFERENCES public.electrical_raceways(id) ON DELETE SET NULL,
  raceway_ref text,
  service_type text,
  conductor_material text,
  conductor_size text,
  conductor_count integer,
  neutral_conductor text,
  ground_conductor text,
  voltage numeric,
  phase text,
  ampacity_amps numeric,
  ocp_rating_amps numeric,
  ocp_type text,
  demand_basis text,
  demand_va numeric,
  planned_length_ft numeric,
  measured_length_ft numeric,
  backup_class text,
  critical boolean NOT NULL DEFAULT false,
  future boolean NOT NULL DEFAULT false,
  install_status text NOT NULL DEFAULT 'planned',
  completion_percent numeric NOT NULL DEFAULT 0,
  label_status text NOT NULL DEFAULT 'none',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, feeder_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_feeders TO authenticated;
GRANT ALL ON public.electrical_feeders TO service_role;
ALTER TABLE public.electrical_feeders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own feeders select" ON public.electrical_feeders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own feeders insert" ON public.electrical_feeders FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own feeders update" ON public.electrical_feeders FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own feeders delete" ON public.electrical_feeders FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER electrical_feeders_set_updated_at BEFORE UPDATE ON public.electrical_feeders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX electrical_feeders_user_idx ON public.electrical_feeders (user_id);
CREATE INDEX electrical_feeders_source_panel_idx ON public.electrical_feeders (source_panel_uuid);
CREATE INDEX electrical_feeders_dest_panel_idx ON public.electrical_feeders (dest_panel_uuid);

-- Self-feeding is never valid topology.
CREATE OR REPLACE FUNCTION public.electrical_validate_feeder_endpoints()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.source_panel_uuid IS NOT NULL
     AND NEW.dest_panel_uuid IS NOT NULL
     AND NEW.source_panel_uuid = NEW.dest_panel_uuid THEN
    RAISE EXCEPTION 'A feeder cannot start and end at the same panel';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER electrical_feeders_validate_endpoints
BEFORE INSERT OR UPDATE ON public.electrical_feeders
FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_feeder_endpoints();