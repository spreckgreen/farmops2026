CREATE TABLE public.electrical_service_panels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  service_config_uuid UUID NOT NULL REFERENCES public.electrical_service_configurations(id) ON DELETE CASCADE,
  panel_uuid UUID REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  panel_ref TEXT,
  role TEXT,
  sequence INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_config_uuid, panel_uuid)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_service_panels TO authenticated;
GRANT ALL ON public.electrical_service_panels TO service_role;
ALTER TABLE public.electrical_service_panels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_panels_select_own" ON public.electrical_service_panels FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "service_panels_insert_own" ON public.electrical_service_panels FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "service_panels_update_own" ON public.electrical_service_panels FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "service_panels_delete_own" ON public.electrical_service_panels FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX electrical_service_panels_config_idx ON public.electrical_service_panels (service_config_uuid, sequence);
CREATE TRIGGER set_updated_at_electrical_service_panels BEFORE UPDATE ON public.electrical_service_panels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();