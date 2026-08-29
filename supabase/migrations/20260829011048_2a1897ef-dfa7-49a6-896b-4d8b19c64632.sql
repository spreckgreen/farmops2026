-- ============ Panels ============
CREATE TABLE public.electrical_panels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  panel_id text NOT NULL,
  description text,
  building text,
  grid text,
  bus_rating_amps numeric,
  voltage numeric,
  phase text,
  spaces integer,
  circuits integer,
  feeder_source text,
  backup_class text,
  install_status text NOT NULL DEFAULT 'planned',
  completion_percent numeric NOT NULL DEFAULT 0,
  label_status text NOT NULL DEFAULT 'none',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, panel_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_panels TO authenticated;
GRANT ALL ON public.electrical_panels TO service_role;
ALTER TABLE public.electrical_panels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own panels select" ON public.electrical_panels FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own panels insert" ON public.electrical_panels FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own panels update" ON public.electrical_panels FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own panels delete" ON public.electrical_panels FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER electrical_panels_set_updated_at BEFORE UPDATE ON public.electrical_panels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Circuit groups ============
CREATE TABLE public.electrical_circuit_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  circuit_group_id text NOT NULL,
  description text,
  panel_uuid uuid REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  suggested_panel text,
  breaker_number integer,
  breaker_position text,
  circuit_rating_amps numeric,
  voltage numeric,
  phase text,
  demand_basis text,
  demand_va numeric,
  continuous_load boolean NOT NULL DEFAULT false,
  critical boolean NOT NULL DEFAULT false,
  backup_eligible boolean NOT NULL DEFAULT false,
  backup_priority text,
  backup_panel text,
  load_shed_group text,
  generator_start_class text,
  generator_start_amps numeric,
  install_status text NOT NULL DEFAULT 'planned',
  completion_percent numeric NOT NULL DEFAULT 0,
  label_status text NOT NULL DEFAULT 'none',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, circuit_group_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_circuit_groups TO authenticated;
GRANT ALL ON public.electrical_circuit_groups TO service_role;
ALTER TABLE public.electrical_circuit_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own circuit groups select" ON public.electrical_circuit_groups FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own circuit groups insert" ON public.electrical_circuit_groups FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own circuit groups update" ON public.electrical_circuit_groups FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own circuit groups delete" ON public.electrical_circuit_groups FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER electrical_circuit_groups_set_updated_at BEFORE UPDATE ON public.electrical_circuit_groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Junction boxes ============
CREATE TABLE public.electrical_junction_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  jbox_id text NOT NULL,
  description text,
  building text,
  grid text,
  elevation_zone text,
  box_type text,
  dimensions text,
  install_status text NOT NULL DEFAULT 'planned',
  completion_percent numeric NOT NULL DEFAULT 0,
  label_status text NOT NULL DEFAULT 'none',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, jbox_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_junction_boxes TO authenticated;
GRANT ALL ON public.electrical_junction_boxes TO service_role;
ALTER TABLE public.electrical_junction_boxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own jboxes select" ON public.electrical_junction_boxes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own jboxes insert" ON public.electrical_junction_boxes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own jboxes update" ON public.electrical_junction_boxes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own jboxes delete" ON public.electrical_junction_boxes FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER electrical_junction_boxes_set_updated_at BEFORE UPDATE ON public.electrical_junction_boxes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Raceways ============
CREATE TABLE public.electrical_raceways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conduit_id text NOT NULL,
  description text,
  environment text NOT NULL DEFAULT 'INTERIOR',
  raceway_type text,
  trade_size text,
  material text,
  source_endpoint_type text,
  source_endpoint_ref text,
  source_panel_uuid uuid REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  source_jbox_uuid uuid REFERENCES public.electrical_junction_boxes(id) ON DELETE SET NULL,
  dest_endpoint_type text,
  dest_endpoint_ref text,
  dest_panel_uuid uuid REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  dest_jbox_uuid uuid REFERENCES public.electrical_junction_boxes(id) ON DELETE SET NULL,
  source_building text,
  dest_building text,
  source_grid text,
  dest_grid text,
  exit_order integer,
  exit_side text,
  exit_notes text,
  planned_length_ft numeric,
  measured_length_ft numeric,
  circuit_refs text,
  spare boolean NOT NULL DEFAULT false,
  install_status text NOT NULL DEFAULT 'planned',
  completion_percent numeric NOT NULL DEFAULT 0,
  label_status text NOT NULL DEFAULT 'none',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, conduit_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_raceways TO authenticated;
GRANT ALL ON public.electrical_raceways TO service_role;
ALTER TABLE public.electrical_raceways ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own raceways select" ON public.electrical_raceways FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own raceways insert" ON public.electrical_raceways FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own raceways update" ON public.electrical_raceways FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own raceways delete" ON public.electrical_raceways FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER electrical_raceways_set_updated_at BEFORE UPDATE ON public.electrical_raceways FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.electrical_raceway_waypoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  raceway_id uuid NOT NULL REFERENCES public.electrical_raceways(id) ON DELETE CASCADE,
  sequence integer NOT NULL DEFAULT 0,
  label text,
  grid text,
  direction text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX electrical_raceway_waypoints_raceway_idx ON public.electrical_raceway_waypoints (raceway_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_raceway_waypoints TO authenticated;
GRANT ALL ON public.electrical_raceway_waypoints TO service_role;
ALTER TABLE public.electrical_raceway_waypoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own waypoints select" ON public.electrical_raceway_waypoints FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own waypoints insert" ON public.electrical_raceway_waypoints FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own waypoints update" ON public.electrical_raceway_waypoints FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own waypoints delete" ON public.electrical_raceway_waypoints FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER electrical_raceway_waypoints_set_updated_at BEFORE UPDATE ON public.electrical_raceway_waypoints FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Loads ============
CREATE TABLE public.electrical_loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  load_id text NOT NULL,
  area text,
  description text,
  count integer NOT NULL DEFAULT 1,
  dedicated boolean NOT NULL DEFAULT true,
  grid text,
  location text,
  circuit_group_uuid uuid REFERENCES public.electrical_circuit_groups(id) ON DELETE SET NULL,
  circuit_group_ref text,
  amps numeric,
  volts numeric,
  connected_va numeric,
  demand_basis text,
  demand_va numeric,
  phase text,
  critical boolean NOT NULL DEFAULT false,
  future boolean NOT NULL DEFAULT false,
  continuous_load boolean NOT NULL DEFAULT false,
  backup_eligible boolean NOT NULL DEFAULT false,
  backup_priority text,
  backup_panel text,
  load_shed_group text,
  install_status text NOT NULL DEFAULT 'planned',
  completion_percent numeric NOT NULL DEFAULT 0,
  label_status text NOT NULL DEFAULT 'none',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, load_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_loads TO authenticated;
GRANT ALL ON public.electrical_loads TO service_role;
ALTER TABLE public.electrical_loads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own loads select" ON public.electrical_loads FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own loads insert" ON public.electrical_loads FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own loads update" ON public.electrical_loads FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own loads delete" ON public.electrical_loads FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER electrical_loads_set_updated_at BEFORE UPDATE ON public.electrical_loads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Branch runs ============
CREATE TABLE public.electrical_branch_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  branch_id text NOT NULL,
  source_endpoint_type text,
  source_endpoint_ref text,
  source_panel_uuid uuid REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  source_jbox_uuid uuid REFERENCES public.electrical_junction_boxes(id) ON DELETE SET NULL,
  dest_endpoint_type text,
  dest_endpoint_ref text,
  load_uuid uuid REFERENCES public.electrical_loads(id) ON DELETE SET NULL,
  circuit_group_uuid uuid REFERENCES public.electrical_circuit_groups(id) ON DELETE SET NULL,
  wiring_method text,
  cable_type text,
  conductor_size text,
  conductor_count integer,
  ground_conductor text,
  voltage numeric,
  circuit_rating_amps numeric,
  planned_length_ft numeric,
  measured_length_ft numeric,
  path_notes text,
  install_status text NOT NULL DEFAULT 'planned',
  device_side_connected boolean NOT NULL DEFAULT false,
  source_side_connected boolean NOT NULL DEFAULT false,
  completion_percent numeric NOT NULL DEFAULT 0,
  label_status text NOT NULL DEFAULT 'none',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, branch_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_branch_runs TO authenticated;
GRANT ALL ON public.electrical_branch_runs TO service_role;
ALTER TABLE public.electrical_branch_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own branch runs select" ON public.electrical_branch_runs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own branch runs insert" ON public.electrical_branch_runs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own branch runs update" ON public.electrical_branch_runs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own branch runs delete" ON public.electrical_branch_runs FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER electrical_branch_runs_set_updated_at BEFORE UPDATE ON public.electrical_branch_runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Label queue ============
CREATE TABLE public.electrical_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  entity_kind text NOT NULL,
  entity_stable_id text NOT NULL,
  label_class text NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  reprint_required boolean NOT NULL DEFAULT false,
  template_version text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  printed_at timestamptz,
  installed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX electrical_labels_user_idx ON public.electrical_labels (user_id, entity_kind);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_labels TO authenticated;
GRANT ALL ON public.electrical_labels TO service_role;
ALTER TABLE public.electrical_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own labels select" ON public.electrical_labels FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own labels insert" ON public.electrical_labels FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own labels update" ON public.electrical_labels FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own labels delete" ON public.electrical_labels FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER electrical_labels_set_updated_at BEFORE UPDATE ON public.electrical_labels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Naming standards (shared reference) ============
CREATE TABLE public.electrical_naming_standards (
  key text PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.electrical_naming_standards TO authenticated;
GRANT ALL ON public.electrical_naming_standards TO service_role;
ALTER TABLE public.electrical_naming_standards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read naming standards" ON public.electrical_naming_standards FOR SELECT TO authenticated USING (true);
CREATE TRIGGER electrical_naming_standards_set_updated_at BEFORE UPDATE ON public.electrical_naming_standards FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.electrical_naming_standards (key, title, body, sort_order) VALUES
  ('id_formats', 'Entity ID formats', 'Farm Shop load FS-### (FS-097). Pump House load PH-### (PH-028). Boiler load BL-### (BL-003). House loads keep their existing convention. Panel PNL-* (PNL-FS-CRIT). Raceway CON-### (CON-030). Junction box JB-### (JB-014). Branch run BR-### (BR-057). IDs never encode mutable physical attributes.', 10),
  ('raceway_continuity', 'Continuous raceway rule', 'A CON-### is one continuous physical raceway between actual accessible endpoints. Sweeps, bends, trench direction changes, geographic waypoints and compass changes do NOT create a new conduit ID. A new CON-### starts only at a real boundary: panel termination, equipment termination, accessible pull box, junction box, handhole, or an intentional raceway type/size transition.', 20),
  ('waypoints', 'Waypoint vs endpoint', 'Underground route changes with no physically installed box are route waypoints on the raceway, not junction-box records. Junction boxes represent real installed or planned accessible boxes only.', 30),
  ('environments', 'Interior and site raceways', 'Interior and exterior raceways share one canonical raceway dataset. Environment values: INTERIOR, SITE_UNDERGROUND, SITE_EXTERIOR, BUILDING_TRANSITION. Interior Raceways and Site Raceways are filtered views, never separate authorities.', 40),
  ('panel_exit', 'Panel raceway physical exit convention', 'Standing in front of and facing a panel, start at the lower-right corner and assign physical raceway exit positions counterclockwise around the perimeter: up the right side, across the top, down the left side, then across the bottom. Physical exit order may change without changing the stable CON-###.', 50),
  ('farm_shop_walk', 'Farm Shop installation walk', 'A6 is the northeast (NE) corner. The perimeter walk begins at A6 and travels clockwise, continuing outside-in as a rectangular spiral; each inner rectangle begins at its northeast side and follows the same clockwise pattern. This is sort/display/installation order only and never changes stable Load IDs.', 60),
  ('breaker_positions', 'Breaker position convention', 'Circuit assignment records both the electrical breaker/circuit number and a field-friendly physical position. Position ranges derive from each panel''s configured space count (for a 48-space panel: Left 1-24 and Right 1-24). Never assume 48 positions.', 70),
  ('labels', 'Label conventions', 'Five label classes: load/device/circuit, panel/breaker, raceway/conduit, junction box, branch run. Stable IDs must stay human-readable without QR codes; QR is optional convenience only.', 80);