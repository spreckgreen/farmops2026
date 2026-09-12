-- Extend inventory connectivity with compute equipment, cable domains, and
-- reviewable templates transcribed from HamConnectors080624.xlsx.

INSERT INTO public.inventory_item_types (value, label, folder, sort_order)
VALUES (
  '23_3_compute',
  '23.3 Compute',
  '21 Infrastructure systems/23 Communication/23.3 Compute',
  145
)
ON CONFLICT (value) DO UPDATE SET
  label = EXCLUDED.label,
  folder = EXCLUDED.folder,
  sort_order = EXCLUDED.sort_order,
  active = true;

ALTER TABLE public.inventory_cable_specs
  ADD COLUMN IF NOT EXISTS supported_domains text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.inventory_cable_specs
  DROP CONSTRAINT IF EXISTS inventory_cable_specs_supported_domains_check;
ALTER TABLE public.inventory_cable_specs
  ADD CONSTRAINT inventory_cable_specs_supported_domains_check
  CHECK (
    supported_domains <@ ARRAY[
      'ham_radio',
      'communications',
      'compute',
      'network'
    ]::text[]
  );

CREATE INDEX IF NOT EXISTS inventory_cable_specs_supported_domains_idx
  ON public.inventory_cable_specs USING gin(supported_domains);

CREATE TABLE IF NOT EXISTS public.inventory_device_port_templates (
  id text PRIMARY KEY,
  source_name text NOT NULL,
  device_name text NOT NULL,
  inventory_item_type text NOT NULL,
  port_name text NOT NULL,
  direction text NOT NULL DEFAULT 'bidirectional',
  signal_type text NOT NULL,
  connector_type_id text NOT NULL REFERENCES public.connector_types(id),
  connector_gender text NOT NULL,
  polarity text NOT NULL DEFAULT 'standard',
  protocol text,
  impedance_ohms numeric,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (inventory_item_type IN ('23_communication','23_1_network','23_2_ham_radio','23_3_compute')),
  CHECK (direction IN ('input','output','bidirectional')),
  CHECK (signal_type IN ('rf','data','power','display','audio','control','other')),
  CHECK (connector_gender IN ('male','female','plug','receptacle','genderless'))
);

ALTER TABLE public.inventory_device_port_templates ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.inventory_device_port_templates TO authenticated;
GRANT ALL ON public.inventory_device_port_templates TO service_role;
CREATE POLICY inventory_device_port_templates_read
  ON public.inventory_device_port_templates
  FOR SELECT TO authenticated USING (active = true);

INSERT INTO public.inventory_device_port_templates
  (id, source_name, device_name, inventory_item_type, port_name, direction, signal_type,
   connector_type_id, connector_gender, polarity, protocol, impedance_ohms, notes, sort_order)
VALUES
  ('hamconn-sdrplay-1a-ant','HamConnectors080624.xlsx','SDRPlay 1A','23_2_ham_radio','Antenna','input','rf','uhf','male','standard',NULL,50,'Uploaded connector reference; verify against the exact unit before applying.',10),
  ('hamconn-rx-filter-radio','HamConnectors080624.xlsx','Receiver Filter (HF Strong signal)','23_2_ham_radio','Radio side','input','rf','bnc','male','standard',NULL,50,'Connects toward the receiver.',10),
  ('hamconn-rx-filter-ant','HamConnectors080624.xlsx','Receiver Filter (HF Strong signal)','23_2_ham_radio','Antenna side','output','rf','bnc','male','standard',NULL,50,'Connects toward the antenna.',20),
  ('hamconn-sdrplay-duo-rx1','HamConnectors080624.xlsx','SDRPlay Duo','23_2_ham_radio','Receiver input 1','input','rf','sma','female','standard',NULL,50,'Workbook lists two SMA female receiver connections.',10),
  ('hamconn-sdrplay-duo-rx2','HamConnectors080624.xlsx','SDRPlay Duo','23_2_ham_radio','Receiver input 2','input','rf','sma','female','standard',NULL,50,'Workbook lists two SMA female receiver connections.',20),
  ('hamconn-sdrplay-duo-wire','HamConnectors080624.xlsx','SDRPlay Duo','23_2_ham_radio','Random wire input','input','rf','wire-terminal','female','standard',NULL,NULL,'Workbook describes this as Random Wire female; connector form requires field verification.',30),
  ('hamconn-kiwisdr-ant','HamConnectors080624.xlsx','KiwiSDR','23_2_ham_radio','SDR antenna input','input','rf','sma','female','standard',NULL,50,'Uploaded connector reference.',10),
  ('hamconn-ic705-ant','HamConnectors080624.xlsx','IC-705','23_2_ham_radio','Antenna','bidirectional','rf','bnc','male','standard',NULL,50,'Uploaded connector reference; device-side gender should be field-verified.',10),
  ('hamconn-mfj4956-in','HamConnectors080624.xlsx','Signal Splitter (MFJ 4956S)','23_2_ham_radio','Inbound','input','rf','uhf','female','standard',NULL,50,'Uploaded connector reference.',10),
  ('hamconn-mfj4956-out1','HamConnectors080624.xlsx','Signal Splitter (MFJ 4956S)','23_2_ham_radio','Outbound 1','output','rf','uhf','female','standard',NULL,50,'Uploaded connector reference.',20),
  ('hamconn-mfj4956-out2','HamConnectors080624.xlsx','Signal Splitter (MFJ 4956S)','23_2_ham_radio','Outbound 2','output','rf','uhf','female','standard',NULL,50,'Uploaded connector reference.',30),

  ('hamconn-rpi5-usb1','HamConnectors080624.xlsx','RPI5','23_3_compute','USB 1','bidirectional','data','usb-a','receptacle','not_applicable','USB 2.0',NULL,'Uploaded connector reference.',10),
  ('hamconn-rpi5-usb2','HamConnectors080624.xlsx','RPI5','23_3_compute','USB 2','bidirectional','data','usb-a','receptacle','not_applicable','USB 2.0',NULL,'Uploaded connector reference.',20),
  ('hamconn-rpi5-usb3','HamConnectors080624.xlsx','RPI5','23_3_compute','USB 3','bidirectional','data','usb-a','receptacle','not_applicable','USB 3.x',NULL,'Uploaded connector reference.',30),
  ('hamconn-rpi5-usb4','HamConnectors080624.xlsx','RPI5','23_3_compute','USB 4','bidirectional','data','usb-a','receptacle','not_applicable','USB 3.x',NULL,'Uploaded connector reference.',40),
  ('hamconn-rpi5-power','HamConnectors080624.xlsx','RPI5','23_3_compute','Power','input','power','usb-c','receptacle','not_applicable','USB power',NULL,'Uploaded connector reference.',50),
  ('hamconn-rpi5-display1','HamConnectors080624.xlsx','RPI5','23_3_compute','Display 1','output','display','hdmi-d','receptacle','not_applicable','HDMI 2.0',NULL,'Workbook calls this HDMI 2.0 Micro.',60),
  ('hamconn-rpi5-display2','HamConnectors080624.xlsx','RPI5','23_3_compute','Display 2','output','display','hdmi-d','receptacle','not_applicable','HDMI 2.0',NULL,'Workbook calls this HDMI 2.0 Micro.',70),

  ('hamconn-rpi4-usb1','HamConnectors080624.xlsx','RPI4','23_3_compute','USB 1','bidirectional','data','usb-a','receptacle','not_applicable','USB 2.0',NULL,'Uploaded connector reference.',10),
  ('hamconn-rpi4-usb2','HamConnectors080624.xlsx','RPI4','23_3_compute','USB 2','bidirectional','data','usb-a','receptacle','not_applicable','USB 2.0',NULL,'Uploaded connector reference.',20),
  ('hamconn-rpi4-usb3','HamConnectors080624.xlsx','RPI4','23_3_compute','USB 3','bidirectional','data','usb-a','receptacle','not_applicable','USB 3.x',NULL,'Uploaded connector reference.',30),
  ('hamconn-rpi4-usb4','HamConnectors080624.xlsx','RPI4','23_3_compute','USB 4','bidirectional','data','usb-a','receptacle','not_applicable','USB 3.x',NULL,'Uploaded connector reference.',40),
  ('hamconn-rpi4-power','HamConnectors080624.xlsx','RPI4','23_3_compute','Power','input','power','usb-c','receptacle','not_applicable','USB power',NULL,'Uploaded connector reference.',50),
  ('hamconn-rpi4-display1','HamConnectors080624.xlsx','RPI4','23_3_compute','Display 1','output','display','hdmi-d','receptacle','not_applicable','HDMI 2.0',NULL,'Workbook calls this HDMI 2.0 Micro.',60),
  ('hamconn-rpi4-display2','HamConnectors080624.xlsx','RPI4','23_3_compute','Display 2','output','display','hdmi-d','receptacle','not_applicable','HDMI 2.0',NULL,'Workbook calls this HDMI 2.0 Micro.',70),

  ('hamconn-rpi3-usb1','HamConnectors080624.xlsx','RPI3','23_3_compute','USB 1','bidirectional','data','usb-a','receptacle','not_applicable','USB 2.0',NULL,'Duplicate workbook block collapsed into one port set.',10),
  ('hamconn-rpi3-usb2','HamConnectors080624.xlsx','RPI3','23_3_compute','USB 2','bidirectional','data','usb-a','receptacle','not_applicable','USB 2.0',NULL,'Duplicate workbook block collapsed into one port set.',20),
  ('hamconn-rpi3-usb3','HamConnectors080624.xlsx','RPI3','23_3_compute','USB 3','bidirectional','data','usb-a','receptacle','not_applicable','USB 3.x',NULL,'Workbook describes USB 3.0; retain as uploaded pending model verification.',30),
  ('hamconn-rpi3-usb4','HamConnectors080624.xlsx','RPI3','23_3_compute','USB 4','bidirectional','data','usb-a','receptacle','not_applicable','USB 3.x',NULL,'Workbook describes USB 3.0; retain as uploaded pending model verification.',40),
  ('hamconn-rpi3-power','HamConnectors080624.xlsx','RPI3','23_3_compute','Power','input','power','usb-micro-b','receptacle','not_applicable','USB power',NULL,'Second workbook block identifies USB Micro power.',50),
  ('hamconn-rpi3-display','HamConnectors080624.xlsx','RPI3','23_3_compute','Display 1','output','display','hdmi-a','receptacle','not_applicable','HDMI',NULL,'Workbook identifies HDMI Type A.',60)
ON CONFLICT (id) DO UPDATE SET
  source_name = EXCLUDED.source_name,
  device_name = EXCLUDED.device_name,
  inventory_item_type = EXCLUDED.inventory_item_type,
  port_name = EXCLUDED.port_name,
  direction = EXCLUDED.direction,
  signal_type = EXCLUDED.signal_type,
  connector_type_id = EXCLUDED.connector_type_id,
  connector_gender = EXCLUDED.connector_gender,
  polarity = EXCLUDED.polarity,
  protocol = EXCLUDED.protocol,
  impedance_ohms = EXCLUDED.impedance_ohms,
  notes = EXCLUDED.notes,
  sort_order = EXCLUDED.sort_order,
  active = true;

COMMENT ON COLUMN public.inventory_cable_specs.supported_domains IS
  'One cable may support any combination of ham_radio, communications, compute and network.';
COMMENT ON TABLE public.inventory_device_port_templates IS
  'Reviewable connector templates from uploaded reference files; applying a template creates user-owned inventory_device_ports.';
