CREATE TABLE public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sku text,
  name text,
  category text,
  location text,
  quantity numeric,
  unit text,
  reorder_level numeric,
  unit_cost numeric,
  vendor text,
  notes text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_items TO authenticated;
GRANT ALL ON public.inventory_items TO service_role;

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own inventory" ON public.inventory_items
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own inventory" ON public.inventory_items
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own inventory" ON public.inventory_items
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own inventory" ON public.inventory_items
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX inventory_items_user_name_idx ON public.inventory_items (user_id, name);

CREATE TRIGGER inventory_items_set_updated_at
BEFORE UPDATE ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();