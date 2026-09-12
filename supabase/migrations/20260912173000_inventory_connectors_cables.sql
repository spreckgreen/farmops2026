-- Connector, device-port, cable and kit compatibility model.
-- Additive: existing inventory rows remain unchanged.

CREATE TABLE IF NOT EXISTS public.connector_types (
  id text PRIMARY KEY,
  family text NOT NULL,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  aliases text[] NOT NULL DEFAULT '{}',
  mating_key text NOT NULL,
  typical_impedance_ohms numeric,
  pin_count integer,
  reference_url text,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (family IN ('rf_coax','usb','display','network','audio','power','control','other')),
  CHECK (pin_count IS NULL OR pin_count > 0)
);

CREATE INDEX IF NOT EXISTS connector_types_family_name_idx
  ON public.connector_types(family, display_name);
CREATE INDEX IF NOT EXISTS connector_types_aliases_gin_idx
  ON public.connector_types USING gin(aliases);

ALTER TABLE public.connector_types ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.connector_types TO authenticated;
GRANT ALL ON public.connector_types TO service_role;

CREATE POLICY connector_types_read_catalog ON public.connector_types
  FOR SELECT TO authenticated USING (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY connector_types_insert_custom ON public.connector_types
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY connector_types_update_custom ON public.connector_types
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY connector_types_delete_custom ON public.connector_types
  FOR DELETE TO authenticated USING (user_id = auth.uid());

INSERT INTO public.connector_types
  (id, family, display_name, description, aliases, mating_key, typical_impedance_ohms, pin_count, reference_url)
VALUES
  ('bnc','rf_coax','BNC','Bayonet-lock coaxial RF connector; select 50 or 75 ohm on the port or cable.','{"Bayonet Neill-Concelman"}','bnc',NULL,1,'https://www.amphenolrf.com/connectors/bnc-connectors.html'),
  ('sma','rf_coax','SMA','Threaded subminiature coaxial RF connector.','{"SubMiniature A"}','sma',50,1,'https://www.amphenolrf.com/connectors/sma-connectors.html'),
  ('rp-sma','rf_coax','RP-SMA','Reverse-polarity SMA; mechanically similar to SMA but the center contact is reversed.','{"Reverse Polarity SMA","RPSMA"}','rp-sma',50,1,'https://www.amphenolrf.com/connectors/rp-sma-connectors.html'),
  ('uhf','rf_coax','UHF (PL-259 / SO-239)','UHF coaxial interface: PL-259 is the usual plug and SO-239 the usual receptacle.','{"PL-259","PL259","PL2059","SO-239","SO239","UHF connector"}','uhf',50,1,'https://www.amphenolrf.com/connectors/uhf-connectors.html'),
  ('n','rf_coax','Type N','Threaded, weather-capable coaxial RF connector.','{"N connector","N-Type"}','n',50,1,'https://www.amphenolrf.com/connectors/type-n-connectors.html'),
  ('tnc','rf_coax','TNC','Threaded coaxial RF connector related to BNC.','{"Threaded Neill-Concelman"}','tnc',50,1,'https://www.amphenolrf.com/connectors/tnc-connectors.html'),
  ('mini-uhf','rf_coax','Mini-UHF','Compact threaded UHF-family coaxial connector.','{"Mini UHF"}','mini-uhf',50,1,NULL),
  ('mcx','rf_coax','MCX','Small snap-on coaxial RF connector.','{}','mcx',50,1,NULL),
  ('mmcx','rf_coax','MMCX','Micro-miniature snap-on coaxial RF connector.','{}','mmcx',50,1,NULL),
  ('usb-a','usb','USB Type-A','Rectangular USB Type-A connector; record protocol/speed separately.','{"USB A","USB-A"}','usb-a',NULL,4,'https://www.usb.org/documents'),
  ('usb-b','usb','USB Type-B','Square USB Type-B peripheral connector; record protocol/speed separately.','{"USB B","USB-B"}','usb-b',NULL,4,'https://www.usb.org/documents'),
  ('usb-c','usb','USB Type-C','Reversible USB Type-C connector; connector shape alone does not establish speed, power or video capability.','{"USB C","USB-C","Type-C"}','usb-c',NULL,24,'https://www.usb.org/document-library/usb-type-cr-cable-and-connector-specification-release-24'),
  ('usb-mini-b','usb','USB Mini-B','Legacy small USB Mini-B connector.','{"Mini USB","USB Mini B"}','usb-mini-b',NULL,5,NULL),
  ('usb-micro-b','usb','USB Micro-B','Legacy small USB Micro-B connector.','{"Micro USB","USB Micro B"}','usb-micro-b',NULL,5,NULL),
  ('usb-micro-b-ss','usb','USB Micro-B SuperSpeed','Wide two-part USB Micro-B connector used by USB 3.x peripherals.','{"USB 3 Micro B","Micro-B SuperSpeed"}','usb-micro-b-ss',NULL,10,NULL),
  ('hdmi-a','display','HDMI Type-A','Standard-size HDMI connector.','{"HDMI","Standard HDMI"}','hdmi-a',NULL,19,NULL),
  ('hdmi-c','display','Mini-HDMI Type-C','Miniature HDMI Type-C connector.','{"Mini HDMI","HDMI Mini"}','hdmi-c',NULL,19,NULL),
  ('hdmi-d','display','Micro-HDMI Type-D','Micro HDMI Type-D connector.','{"Micro HDMI","HDMI Micro"}','hdmi-d',NULL,19,NULL),
  ('displayport','display','DisplayPort','Full-size DisplayPort digital display connector.','{"DP"}','displayport',NULL,20,NULL),
  ('rj45','network','8P8C (RJ45 commonly used)','Eight-position modular connector commonly called RJ45.','{"RJ45","Ethernet"}','rj45',NULL,8,NULL),
  ('trs-2.5','audio','2.5 mm phone connector','2.5 mm TS/TRS/TRRS audio or control connector; record contact count separately.','{"2.5mm","Submini phone"}','trs-2.5',NULL,NULL,NULL),
  ('trs-3.5','audio','3.5 mm phone connector','3.5 mm TS/TRS/TRRS audio or control connector; record contact count separately.','{"3.5mm","1/8 inch","Mini phone"}','trs-3.5',NULL,NULL,NULL),
  ('trs-6.35','audio','6.35 mm (1/4 inch) phone connector','Quarter-inch TS/TRS phone connector.','{"1/4 inch","6.35mm"}','trs-6.35',NULL,NULL,NULL),
  ('anderson-powerpole','power','Anderson Powerpole','Genderless modular DC power connector; record housing series, color and contact rating.','{"Powerpole","Anderson PP"}','anderson-powerpole',NULL,2,NULL),
  ('dc-barrel','power','DC coaxial barrel','Coaxial DC power connector; record outer/inner dimensions and polarity.','{"Barrel connector","DC barrel"}','dc-barrel',NULL,2,NULL)
ON CONFLICT (id) DO UPDATE SET
  family = EXCLUDED.family,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  aliases = EXCLUDED.aliases,
  mating_key = EXCLUDED.mating_key,
  typical_impedance_ohms = EXCLUDED.typical_impedance_ohms,
  pin_count = EXCLUDED.pin_count,
  reference_url = EXCLUDED.reference_url
WHERE connector_types.user_id IS NULL;

CREATE TABLE IF NOT EXISTS public.inventory_device_ports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  name text NOT NULL,
  direction text NOT NULL DEFAULT 'bidirectional',
  signal_type text NOT NULL DEFAULT 'other',
  connector_type_id text NOT NULL REFERENCES public.connector_types(id),
  connector_gender text NOT NULL DEFAULT 'receptacle',
  polarity text NOT NULL DEFAULT 'standard',
  protocol text,
  impedance_ohms numeric,
  min_frequency_hz numeric,
  max_frequency_hz numeric,
  voltage_v numeric,
  max_current_a numeric,
  max_power_w numeric,
  required boolean NOT NULL DEFAULT false,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (direction IN ('input','output','bidirectional')),
  CHECK (signal_type IN ('rf','data','power','display','audio','control','other')),
  CHECK (connector_gender IN ('male','female','plug','receptacle','genderless')),
  CHECK (polarity IN ('standard','reverse','not_applicable')),
  CHECK (impedance_ohms IS NULL OR impedance_ohms > 0),
  CHECK (max_frequency_hz IS NULL OR max_frequency_hz >= 0),
  CHECK (max_current_a IS NULL OR max_current_a >= 0),
  CHECK (max_power_w IS NULL OR max_power_w >= 0)
);

CREATE INDEX IF NOT EXISTS inventory_device_ports_item_idx
  ON public.inventory_device_ports(user_id, inventory_item_id);

CREATE TABLE IF NOT EXISTS public.inventory_cable_specs (
  inventory_item_id uuid PRIMARY KEY REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cable_type text,
  length numeric,
  length_unit text NOT NULL DEFAULT 'ft',
  awg numeric,
  impedance_ohms numeric,
  shielding text,
  signal_types text[] NOT NULL DEFAULT '{}',
  protocol text,
  max_frequency_hz numeric,
  voltage_v numeric,
  max_current_a numeric,
  max_power_w numeric,
  adapter_or_pigtail boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length IS NULL OR length >= 0),
  CHECK (length_unit IN ('in','ft','mm','cm','m')),
  CHECK (awg IS NULL OR (awg >= 0 AND awg <= 60)),
  CHECK (impedance_ohms IS NULL OR impedance_ohms > 0)
);

CREATE TABLE IF NOT EXISTS public.inventory_cable_ends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cable_item_id uuid NOT NULL REFERENCES public.inventory_cable_specs(inventory_item_id) ON DELETE CASCADE,
  end_label text NOT NULL,
  connector_type_id text NOT NULL REFERENCES public.connector_types(id),
  connector_gender text NOT NULL,
  polarity text NOT NULL DEFAULT 'standard',
  contact_count integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cable_item_id, end_label),
  CHECK (end_label IN ('A','B')),
  CHECK (connector_gender IN ('male','female','plug','receptacle','genderless')),
  CHECK (polarity IN ('standard','reverse','not_applicable')),
  CHECK (contact_count IS NULL OR contact_count > 0)
);

CREATE INDEX IF NOT EXISTS inventory_cable_ends_connector_idx
  ON public.inventory_cable_ends(user_id, connector_type_id, connector_gender);

CREATE TABLE IF NOT EXISTS public.kit_connection_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kit_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  source_device_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  source_port_id uuid REFERENCES public.inventory_device_ports(id) ON DELETE SET NULL,
  target_device_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  target_port_id uuid REFERENCES public.inventory_device_ports(id) ON DELETE SET NULL,
  assigned_cable_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  quantity numeric NOT NULL DEFAULT 1,
  required boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS kit_connection_requirements_kit_idx
  ON public.kit_connection_requirements(user_id, kit_item_id);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'inventory_device_ports',
    'inventory_cable_specs',
    'inventory_cable_ends',
    'kit_connection_requirements'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid())',
      table_name || '_select_own', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())',
      table_name || '_insert_own', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())',
      table_name || '_update_own', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (user_id = auth.uid())',
      table_name || '_delete_own', table_name
    );
  END LOOP;
END $$;

CREATE TRIGGER inventory_device_ports_set_updated_at
  BEFORE UPDATE ON public.inventory_device_ports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER inventory_cable_specs_set_updated_at
  BEFORE UPDATE ON public.inventory_cable_specs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER inventory_cable_ends_set_updated_at
  BEFORE UPDATE ON public.inventory_cable_ends
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER kit_connection_requirements_set_updated_at
  BEFORE UPDATE ON public.kit_connection_requirements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.connector_types IS 'Managed connector dropdown catalog. Connector shape is separate from protocol, speed and power capability.';
COMMENT ON TABLE public.inventory_device_ports IS 'Named inputs and outputs on radios, tuners, amplifiers, computers and other inventory devices.';
COMMENT ON TABLE public.inventory_cable_specs IS 'Cable-level inventory attributes such as length, AWG, impedance and ratings.';
COMMENT ON TABLE public.inventory_cable_ends IS 'Exactly two orientation-independent connector ends, A and B, for each cable inventory item.';
COMMENT ON TABLE public.kit_connection_requirements IS 'Connections a kit must be able to make and the physical cable assigned to satisfy each one.';
