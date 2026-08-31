CREATE TABLE public.electrical_services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  service_id TEXT NOT NULL,
  name TEXT,
  site_code TEXT,
  building TEXT,
  utility_account TEXT,
  notes TEXT,
  ods_extras TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, service_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_services TO authenticated;
GRANT ALL ON public.electrical_services TO service_role;
ALTER TABLE public.electrical_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "services_select_own" ON public.electrical_services FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "services_insert_own" ON public.electrical_services FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "services_update_own" ON public.electrical_services FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "services_delete_own" ON public.electrical_services FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.electrical_service_configurations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  service_uuid UUID NOT NULL REFERENCES public.electrical_services(id) ON DELETE CASCADE,
  service_ref TEXT,
  lifecycle_state TEXT NOT NULL DEFAULT 'planned',
  is_current BOOLEAN NOT NULL DEFAULT false,
  revision_label TEXT,
  ampacity_amps NUMERIC,
  voltage TEXT,
  phase TEXT,
  service_equipment TEXT,
  meter_arrangement TEXT,
  entry_point TEXT,
  effective_date DATE,
  commissioned_date DATE,
  retired_date DATE,
  notes TEXT,
  ods_extras TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX electrical_service_config_one_current
  ON public.electrical_service_configurations (service_uuid)
  WHERE is_current;
CREATE INDEX electrical_service_config_service_idx
  ON public.electrical_service_configurations (service_uuid, lifecycle_state);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_service_configurations TO authenticated;
GRANT ALL ON public.electrical_service_configurations TO service_role;
ALTER TABLE public.electrical_service_configurations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_configs_select_own" ON public.electrical_service_configurations FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "service_configs_insert_own" ON public.electrical_service_configurations FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "service_configs_update_own" ON public.electrical_service_configurations FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "service_configs_delete_own" ON public.electrical_service_configurations FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.electrical_interties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  intertie_id TEXT NOT NULL,
  name TEXT,
  notes TEXT,
  ods_extras TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, intertie_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_interties TO authenticated;
GRANT ALL ON public.electrical_interties TO service_role;
ALTER TABLE public.electrical_interties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "interties_select_own" ON public.electrical_interties FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "interties_insert_own" ON public.electrical_interties FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "interties_update_own" ON public.electrical_interties FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "interties_delete_own" ON public.electrical_interties FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.electrical_intertie_configurations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  intertie_uuid UUID NOT NULL REFERENCES public.electrical_interties(id) ON DELETE CASCADE,
  intertie_ref TEXT,
  lifecycle_state TEXT NOT NULL DEFAULT 'proposed',
  is_current BOOLEAN NOT NULL DEFAULT false,
  revision_label TEXT,
  endpoint_a_service_uuid UUID REFERENCES public.electrical_services(id) ON DELETE SET NULL,
  endpoint_a_ref TEXT,
  endpoint_b_service_uuid UUID REFERENCES public.electrical_services(id) ON DELETE SET NULL,
  endpoint_b_ref TEXT,
  endpoint_a_panel_uuid UUID REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  endpoint_b_panel_uuid UUID REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  transfer_method TEXT,
  isolation_method TEXT,
  capacity_amps NUMERIC,
  normal_state TEXT,
  permitted_states TEXT,
  effective_date DATE,
  commissioned_date DATE,
  retired_date DATE,
  notes TEXT,
  ods_extras TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX electrical_intertie_config_one_current
  ON public.electrical_intertie_configurations (intertie_uuid)
  WHERE is_current;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_intertie_configurations TO authenticated;
GRANT ALL ON public.electrical_intertie_configurations TO service_role;
ALTER TABLE public.electrical_intertie_configurations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intertie_configs_select_own" ON public.electrical_intertie_configurations FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "intertie_configs_insert_own" ON public.electrical_intertie_configurations FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "intertie_configs_update_own" ON public.electrical_intertie_configurations FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "intertie_configs_delete_own" ON public.electrical_intertie_configurations FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER set_updated_at_electrical_services BEFORE UPDATE ON public.electrical_services FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at_electrical_service_configurations BEFORE UPDATE ON public.electrical_service_configurations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at_electrical_interties BEFORE UPDATE ON public.electrical_interties FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at_electrical_intertie_configurations BEFORE UPDATE ON public.electrical_intertie_configurations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();