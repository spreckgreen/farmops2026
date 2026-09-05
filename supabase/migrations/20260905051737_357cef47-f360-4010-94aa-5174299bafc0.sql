-- 1. Extend the controlled-vocabulary helper with switch/control domains.
CREATE OR REPLACE FUNCTION public.electrical_allowed(_domain text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _domain
    WHEN 'install_status' THEN ARRAY['planned','material_ready','rough_in_started','raceway_installed','conductors_installed','device_side_connected','source_side_connected','tested','complete','as_built_verified']
    WHEN 'label_status'   THEN ARRAY['none','queued','printed','installed','reprint']
    WHEN 'label_class'    THEN ARRAY['load_device_circuit','panel_breaker','raceway_conduit','junction_box','branch_run']
    WHEN 'endpoint_type'  THEN ARRAY['panel','junction_box','equipment','handhole','load','other','switch_bank']
    WHEN 'environment'    THEN ARRAY['INTERIOR','SITE_UNDERGROUND','SITE_EXTERIOR','BUILDING_TRANSITION']
    WHEN 'exit_side'      THEN ARRAY['Lower Right','Right','Upper Right','Top','Upper Left','Left','Lower Left','Bottom']
    WHEN 'field_verification_status' THEN ARRAY['NOT_REVIEWED','FIELD_CONFIRMATION_REQUIRED','VERIFIED_AS_INSTALLED','UPDATED_FROM_FIELD_OBSERVATION','INTENTIONALLY_MOBILE','NOT_YET_INSTALLED']
    WHEN 'switch_lifecycle' THEN ARRAY['planned','material_ready','box_installed','raceway_installed','conductors_installed','device_installed','terminated','function_tested','as_built_verified','removed_abandoned']
    WHEN 'component_state' THEN ARRAY['not_started','planned','material_ready','installed','terminated','tested','verified','not_applicable','unknown']
    WHEN 'switch_type' THEN ARRAY['single_pole','double_pole','three_way','four_way','dimmer','selector','momentary','keyed','pilot_light','occupancy_sensor','other','unknown']
    WHEN 'control_method' THEN ARRAY['single_location','two_location_three_way','multi_location_three_and_four_way','dimming','selector','automatic_sensor','relay_or_contactor','unknown']
    WHEN 'conductor_function' THEN ARRAY['line_supply','switched_ungrounded','traveler','grounded_conductor','equipment_grounding_conductor','control_conductor','unknown_unverified']
    WHEN 'control_target_kind' THEN ARRAY['load','device','relay','contactor','receptacle_outlet','other','unknown']
    ELSE ARRAY[]::text[]
  END
$function$;

-- 2. Switch banks: the physical device box / enclosure holding switching devices.
CREATE TABLE IF NOT EXISTS public.electrical_switch_banks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  switch_bank_id text NOT NULL,
  description text,
  building text,
  location_note text,
  grid text,
  field_grid_reference text,
  location_x_ft numeric,
  location_y_ft numeric,
  pole_scheme text,
  pole_ref text,
  enclosure_type text,
  gang_count integer,
  installed_device_count integer NOT NULL DEFAULT 0,
  supplying_circuit_group_uuid uuid REFERENCES public.electrical_circuit_groups(id) ON DELETE SET NULL,
  source_jbox_uuid uuid REFERENCES public.electrical_junction_boxes(id) ON DELETE SET NULL,
  lifecycle_status text NOT NULL DEFAULT 'planned',
  box_state text NOT NULL DEFAULT 'not_started',
  raceway_state text NOT NULL DEFAULT 'not_started',
  conductors_state text NOT NULL DEFAULT 'not_started',
  devices_state text NOT NULL DEFAULT 'not_started',
  termination_state text NOT NULL DEFAULT 'not_started',
  function_test_state text NOT NULL DEFAULT 'not_started',
  field_verification_status text NOT NULL DEFAULT 'NOT_REVIEWED',
  evidence text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, switch_bank_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_switch_banks TO authenticated;
GRANT ALL ON public.electrical_switch_banks TO service_role;
ALTER TABLE public.electrical_switch_banks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own switch banks select" ON public.electrical_switch_banks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own switch banks insert" ON public.electrical_switch_banks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own switch banks update" ON public.electrical_switch_banks FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own switch banks delete" ON public.electrical_switch_banks FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "electrical_switch_banks_shared_read" ON public.electrical_switch_banks FOR SELECT TO authenticated USING (private.has_electrical_read(auth.uid()));
CREATE POLICY "electrical_switch_banks_shared_field_update" ON public.electrical_switch_banks FOR UPDATE TO authenticated USING (private.has_electrical_field_write(auth.uid())) WITH CHECK (private.has_electrical_field_write(auth.uid()));

CREATE TRIGGER electrical_switch_banks_set_updated_at BEFORE UPDATE ON public.electrical_switch_banks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER electrical_switch_banks_controlled BEFORE INSERT OR UPDATE ON public.electrical_switch_banks FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_controlled('lifecycle_status:switch_lifecycle','box_state:component_state','raceway_state:component_state','conductors_state:component_state','devices_state:component_state','termination_state:component_state','function_test_state:component_state','field_verification_status:field_verification_status');

-- 3. Control groups: the logical grouping of switching devices controlling the same target(s).
CREATE TABLE IF NOT EXISTS public.electrical_control_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  control_group_id text NOT NULL,
  description text,
  building text,
  control_method text NOT NULL DEFAULT 'unknown',
  expected_device_count integer,
  supplying_circuit_group_uuid uuid REFERENCES public.electrical_circuit_groups(id) ON DELETE SET NULL,
  design_only boolean NOT NULL DEFAULT true,
  lifecycle_status text NOT NULL DEFAULT 'planned',
  field_verification_status text NOT NULL DEFAULT 'NOT_REVIEWED',
  evidence text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, control_group_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_control_groups TO authenticated;
GRANT ALL ON public.electrical_control_groups TO service_role;
ALTER TABLE public.electrical_control_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own control groups select" ON public.electrical_control_groups FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own control groups insert" ON public.electrical_control_groups FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own control groups update" ON public.electrical_control_groups FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own control groups delete" ON public.electrical_control_groups FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "electrical_control_groups_shared_read" ON public.electrical_control_groups FOR SELECT TO authenticated USING (private.has_electrical_read(auth.uid()));
CREATE POLICY "electrical_control_groups_shared_field_update" ON public.electrical_control_groups FOR UPDATE TO authenticated USING (private.has_electrical_field_write(auth.uid())) WITH CHECK (private.has_electrical_field_write(auth.uid()));

CREATE TRIGGER electrical_control_groups_set_updated_at BEFORE UPDATE ON public.electrical_control_groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER electrical_control_groups_controlled BEFORE INSERT OR UPDATE ON public.electrical_control_groups FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_controlled('control_method:control_method','lifecycle_status:switch_lifecycle','field_verification_status:field_verification_status');

-- 4. Switch devices: individual switching devices inside a bank.
CREATE TABLE IF NOT EXISTS public.electrical_switch_devices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  switch_device_id text NOT NULL,
  description text,
  switch_bank_uuid uuid REFERENCES public.electrical_switch_banks(id) ON DELETE SET NULL,
  gang_position integer,
  switch_type text NOT NULL DEFAULT 'unknown',
  poles integer,
  switching_arrangement text,
  rated_voltage numeric,
  rated_current_amps numeric,
  supplying_circuit_group_uuid uuid REFERENCES public.electrical_circuit_groups(id) ON DELETE SET NULL,
  control_group_uuid uuid REFERENCES public.electrical_control_groups(id) ON DELETE SET NULL,
  is_disconnecting_means boolean NOT NULL DEFAULT false,
  disconnecting_means_verified boolean NOT NULL DEFAULT false,
  lifecycle_status text NOT NULL DEFAULT 'planned',
  device_state text NOT NULL DEFAULT 'not_started',
  termination_state text NOT NULL DEFAULT 'not_started',
  function_test_state text NOT NULL DEFAULT 'not_started',
  field_verification_status text NOT NULL DEFAULT 'NOT_REVIEWED',
  design_only boolean NOT NULL DEFAULT true,
  evidence text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, switch_device_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_switch_devices TO authenticated;
GRANT ALL ON public.electrical_switch_devices TO service_role;
ALTER TABLE public.electrical_switch_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own switch devices select" ON public.electrical_switch_devices FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own switch devices insert" ON public.electrical_switch_devices FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own switch devices update" ON public.electrical_switch_devices FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own switch devices delete" ON public.electrical_switch_devices FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "electrical_switch_devices_shared_read" ON public.electrical_switch_devices FOR SELECT TO authenticated USING (private.has_electrical_read(auth.uid()));
CREATE POLICY "electrical_switch_devices_shared_field_update" ON public.electrical_switch_devices FOR UPDATE TO authenticated USING (private.has_electrical_field_write(auth.uid())) WITH CHECK (private.has_electrical_field_write(auth.uid()));

CREATE TRIGGER electrical_switch_devices_set_updated_at BEFORE UPDATE ON public.electrical_switch_devices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER electrical_switch_devices_controlled BEFORE INSERT OR UPDATE ON public.electrical_switch_devices FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_controlled('switch_type:switch_type','lifecycle_status:switch_lifecycle','device_state:component_state','termination_state:component_state','function_test_state:component_state','field_verification_status:field_verification_status');

-- 5. Controlled targets of a control group (a target may join several groups).
CREATE TABLE IF NOT EXISTS public.electrical_control_targets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  control_group_uuid uuid NOT NULL REFERENCES public.electrical_control_groups(id) ON DELETE CASCADE,
  target_kind text NOT NULL DEFAULT 'unknown',
  load_uuid uuid REFERENCES public.electrical_loads(id) ON DELETE CASCADE,
  device_uuid uuid REFERENCES public.electrical_devices(id) ON DELETE CASCADE,
  target_ref text,
  target_note text,
  design_only boolean NOT NULL DEFAULT true,
  field_verification_status text NOT NULL DEFAULT 'NOT_REVIEWED',
  evidence text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_control_targets TO authenticated;
GRANT ALL ON public.electrical_control_targets TO service_role;
ALTER TABLE public.electrical_control_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own control targets select" ON public.electrical_control_targets FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own control targets insert" ON public.electrical_control_targets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own control targets update" ON public.electrical_control_targets FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own control targets delete" ON public.electrical_control_targets FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "electrical_control_targets_shared_read" ON public.electrical_control_targets FOR SELECT TO authenticated USING (private.has_electrical_read(auth.uid()));
CREATE POLICY "electrical_control_targets_shared_field_update" ON public.electrical_control_targets FOR UPDATE TO authenticated USING (private.has_electrical_field_write(auth.uid())) WITH CHECK (private.has_electrical_field_write(auth.uid()));

CREATE TRIGGER electrical_control_targets_set_updated_at BEFORE UPDATE ON public.electrical_control_targets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER electrical_control_targets_controlled BEFORE INSERT OR UPDATE ON public.electrical_control_targets FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_controlled('target_kind:control_target_kind','field_verification_status:field_verification_status');

-- 6. Physical wiring segments that carry control conductors between endpoints.
CREATE TABLE IF NOT EXISTS public.electrical_control_wiring_segments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  segment_id text,
  description text,
  supplying_circuit_group_uuid uuid REFERENCES public.electrical_circuit_groups(id) ON DELETE SET NULL,
  raceway_uuid uuid REFERENCES public.electrical_raceways(id) ON DELETE SET NULL,
  branch_run_uuid uuid REFERENCES public.electrical_branch_runs(id) ON DELETE SET NULL,
  source_kind text,
  source_switch_bank_uuid uuid REFERENCES public.electrical_switch_banks(id) ON DELETE SET NULL,
  source_jbox_uuid uuid REFERENCES public.electrical_junction_boxes(id) ON DELETE SET NULL,
  source_panel_uuid uuid REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  dest_kind text,
  dest_switch_bank_uuid uuid REFERENCES public.electrical_switch_banks(id) ON DELETE SET NULL,
  dest_jbox_uuid uuid REFERENCES public.electrical_junction_boxes(id) ON DELETE SET NULL,
  dest_load_uuid uuid REFERENCES public.electrical_loads(id) ON DELETE SET NULL,
  cable_or_raceway_label text,
  conductor_count integer,
  conductor_function text NOT NULL DEFAULT 'unknown_unverified',
  observed_marking text,
  install_state text NOT NULL DEFAULT 'installed',
  field_verification_status text NOT NULL DEFAULT 'NOT_REVIEWED',
  evidence text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_control_wiring_segments TO authenticated;
GRANT ALL ON public.electrical_control_wiring_segments TO service_role;
ALTER TABLE public.electrical_control_wiring_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own control segments select" ON public.electrical_control_wiring_segments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own control segments insert" ON public.electrical_control_wiring_segments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own control segments update" ON public.electrical_control_wiring_segments FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own control segments delete" ON public.electrical_control_wiring_segments FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "electrical_control_wiring_segments_shared_read" ON public.electrical_control_wiring_segments FOR SELECT TO authenticated USING (private.has_electrical_read(auth.uid()));
CREATE POLICY "electrical_control_wiring_segments_shared_field_update" ON public.electrical_control_wiring_segments FOR UPDATE TO authenticated USING (private.has_electrical_field_write(auth.uid())) WITH CHECK (private.has_electrical_field_write(auth.uid()));

CREATE TRIGGER electrical_control_wiring_segments_set_updated_at BEFORE UPDATE ON public.electrical_control_wiring_segments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER electrical_control_wiring_segments_controlled BEFORE INSERT OR UPDATE ON public.electrical_control_wiring_segments FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_controlled('conductor_function:conductor_function','field_verification_status:field_verification_status');

-- 7. Existing power objects may reference a switch bank endpoint.
ALTER TABLE public.electrical_branch_runs
  ADD COLUMN IF NOT EXISTS dest_switch_bank_uuid uuid REFERENCES public.electrical_switch_banks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_switch_bank_uuid uuid REFERENCES public.electrical_switch_banks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS electrical_switch_devices_bank_idx ON public.electrical_switch_devices (switch_bank_uuid);
CREATE INDEX IF NOT EXISTS electrical_switch_devices_control_group_idx ON public.electrical_switch_devices (control_group_uuid);
CREATE INDEX IF NOT EXISTS electrical_control_targets_group_idx ON public.electrical_control_targets (control_group_uuid);
CREATE INDEX IF NOT EXISTS electrical_control_segments_source_bank_idx ON public.electrical_control_wiring_segments (source_switch_bank_uuid);
CREATE INDEX IF NOT EXISTS electrical_control_segments_dest_bank_idx ON public.electrical_control_wiring_segments (dest_switch_bank_uuid);