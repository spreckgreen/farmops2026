CREATE TABLE public.inventory_components (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  component_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity numeric NOT NULL DEFAULT 1,
  unit text,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT inventory_components_no_self CHECK (parent_item_id <> component_item_id),
  CONSTRAINT inventory_components_qty_positive CHECK (quantity > 0),
  CONSTRAINT inventory_components_unique UNIQUE (parent_item_id, component_item_id)
);

CREATE INDEX inventory_components_parent_idx ON public.inventory_components (parent_item_id);
CREATE INDEX inventory_components_component_idx ON public.inventory_components (component_item_id);
CREATE INDEX inventory_components_user_idx ON public.inventory_components (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_components TO authenticated;
GRANT ALL ON public.inventory_components TO service_role;

ALTER TABLE public.inventory_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_components_select_own" ON public.inventory_components
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "inventory_components_insert_own" ON public.inventory_components
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "inventory_components_update_own" ON public.inventory_components
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "inventory_components_delete_own" ON public.inventory_components
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER inventory_components_set_updated_at
  BEFORE UPDATE ON public.inventory_components
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();