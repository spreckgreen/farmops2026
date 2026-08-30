-- Phase 4.4a addendum: reusable Equipment Rack, Power Distribution Asset and
-- powered Device entities. FarmOps-native infrastructure/as-built extensions:
-- purely additive, nothing existing is altered, renamed or recreated.

CREATE TABLE public.electrical_racks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rack_id text NOT NULL,
  description text,
  site_area text,
  building text,
  grid text,
  location_note text,
  rack_role text,
  rack_size_u integer,
  mounting text,
  install_status text NOT NULL DEFAULT 'planned',
  completion_percent numeric,
  label_status text NOT NULL DEFAULT 'none',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX electrical_racks_user_stable_id_key ON public.electrical_racks (user_id, rack_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_racks TO authenticated;
GRANT ALL ON public.electrical_racks TO service_role;
ALTER TABLE public.electrical_racks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own racks select" ON public.electrical_racks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own racks insert" ON public.electrical_racks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own racks update" ON public.electrical_racks FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own racks delete" ON public.electrical_racks FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER electrical_racks_set_updated_at BEFORE UPDATE ON public.electrical_racks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.electrical_racks IS 'FarmOps-native physical equipment rack/cabinet. Reusable for network, ham radio or any other role - the role is data, never a separate table.';

CREATE TABLE public.electrical_power_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  power_asset_id text NOT NULL,
  description text,
  asset_type text NOT NULL DEFAULT 'AC_DC_POWER_SUPPLY'
    CHECK (asset_type IN ('AC_DC_POWER_SUPPLY','UPS','PDU','DC_DISTRIBUTION')),
  manufacturer text,
  model text,
  input_type text,
  input_voltage numeric,
  input_current_amps numeric,
  output_type text,
  output_voltage numeric,
  output_current_amps numeric,
  capacity_note text,
  rack_uuid uuid REFERENCES public.electrical_racks(id) ON DELETE SET NULL,
  rack_ref text,
  building text,
  grid text,
  location_note text,
  source_panel_uuid uuid REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  source_panel_ref text,
  source_circuit_group_uuid uuid REFERENCES public.electrical_circuit_groups(id) ON DELETE SET NULL,
  source_circuit_group_ref text,
  source_load_uuid uuid REFERENCES public.electrical_loads(id) ON DELETE SET NULL,
  source_load_ref text,
  source_branch_uuid uuid REFERENCES public.electrical_branch_runs(id) ON DELETE SET NULL,
  source_branch_ref text,
  upstream_power_asset_uuid uuid REFERENCES public.electrical_power_assets(id) ON DELETE SET NULL,
  upstream_power_asset_ref text,
  install_status text NOT NULL DEFAULT 'planned',
  completion_percent numeric,
  label_status text NOT NULL DEFAULT 'none',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX electrical_power_assets_user_stable_id_key ON public.electrical_power_assets (user_id, power_asset_id);
CREATE INDEX electrical_power_assets_rack_idx ON public.electrical_power_assets (rack_uuid);
CREATE INDEX electrical_power_assets_upstream_idx ON public.electrical_power_assets (upstream_power_asset_uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_power_assets TO authenticated;
GRANT ALL ON public.electrical_power_assets TO service_role;
ALTER TABLE public.electrical_power_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own power assets select" ON public.electrical_power_assets FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own power assets insert" ON public.electrical_power_assets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own power assets update" ON public.electrical_power_assets FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own power assets delete" ON public.electrical_power_assets FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER electrical_power_assets_set_updated_at BEFORE UPDATE ON public.electrical_power_assets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.electrical_power_assets IS 'Reusable power distribution asset (AC/DC supply, UPS, PDU, DC distribution) that accepts one power source and supplies one or more downstream devices. Type is data, not architecture.';
COMMENT ON COLUMN public.electrical_power_assets.upstream_power_asset_uuid IS 'Immediate upstream power asset, e.g. a PDU fed from a UPS.';

CREATE TABLE public.electrical_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  description text,
  device_role text,
  device_type text,
  manufacturer text,
  model text,
  hostname text,
  address text,
  rack_uuid uuid REFERENCES public.electrical_racks(id) ON DELETE SET NULL,
  rack_ref text,
  rack_position_u integer,
  building text,
  grid text,
  location_note text,
  power_asset_uuid uuid REFERENCES public.electrical_power_assets(id) ON DELETE SET NULL,
  power_asset_ref text,
  circuit_group_uuid uuid REFERENCES public.electrical_circuit_groups(id) ON DELETE SET NULL,
  circuit_group_ref text,
  load_uuid uuid REFERENCES public.electrical_loads(id) ON DELETE SET NULL,
  load_ref text,
  uplink_device_uuid uuid REFERENCES public.electrical_devices(id) ON DELETE SET NULL,
  uplink_device_ref text,
  input_voltage numeric,
  input_current_amps numeric,
  install_status text NOT NULL DEFAULT 'planned',
  completion_percent numeric,
  label_status text NOT NULL DEFAULT 'none',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX electrical_devices_user_stable_id_key ON public.electrical_devices (user_id, device_id);
CREATE INDEX electrical_devices_rack_idx ON public.electrical_devices (rack_uuid);
CREATE INDEX electrical_devices_power_asset_idx ON public.electrical_devices (power_asset_uuid);
CREATE INDEX electrical_devices_uplink_idx ON public.electrical_devices (uplink_device_uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_devices TO authenticated;
GRANT ALL ON public.electrical_devices TO service_role;
ALTER TABLE public.electrical_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own devices select" ON public.electrical_devices FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own devices insert" ON public.electrical_devices FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own devices update" ON public.electrical_devices FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own devices delete" ON public.electrical_devices FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER electrical_devices_set_updated_at BEFORE UPDATE ON public.electrical_devices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.electrical_devices IS 'Powered device installed in a rack and/or fed by a power asset. Preserves both the immediate power source (power_asset_uuid) and the upstream electrical source (circuit_group_uuid / load_uuid) so failure domains are computable.';