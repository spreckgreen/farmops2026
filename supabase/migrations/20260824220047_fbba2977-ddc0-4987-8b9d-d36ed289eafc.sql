CREATE TABLE public.kit_deployments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kit_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '',
  units numeric NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'open',
  checked_out_at timestamp with time zone NOT NULL DEFAULT now(),
  returned_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX kit_deployments_user_kit_idx ON public.kit_deployments (user_id, kit_item_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kit_deployments TO authenticated;
GRANT ALL ON public.kit_deployments TO service_role;

ALTER TABLE public.kit_deployments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kit_deployments_select_own" ON public.kit_deployments
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "kit_deployments_insert_own" ON public.kit_deployments
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "kit_deployments_update_own" ON public.kit_deployments
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "kit_deployments_delete_own" ON public.kit_deployments
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER kit_deployments_set_updated_at
  BEFORE UPDATE ON public.kit_deployments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.kit_deployment_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deployment_id uuid NOT NULL REFERENCES public.kit_deployments(id) ON DELETE CASCADE,
  component_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  component_name text NOT NULL DEFAULT '',
  unit text,
  quantity_out numeric NOT NULL DEFAULT 0,
  quantity_returned numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX kit_deployment_lines_deployment_idx ON public.kit_deployment_lines (deployment_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kit_deployment_lines TO authenticated;
GRANT ALL ON public.kit_deployment_lines TO service_role;

ALTER TABLE public.kit_deployment_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kit_deployment_lines_select_own" ON public.kit_deployment_lines
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "kit_deployment_lines_insert_own" ON public.kit_deployment_lines
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "kit_deployment_lines_update_own" ON public.kit_deployment_lines
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "kit_deployment_lines_delete_own" ON public.kit_deployment_lines
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER kit_deployment_lines_set_updated_at
  BEFORE UPDATE ON public.kit_deployment_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();