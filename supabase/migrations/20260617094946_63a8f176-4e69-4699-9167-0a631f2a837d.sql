CREATE TABLE public.food_storage_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  food_type TEXT,
  location TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'lb',
  acquired_on DATE,
  best_by DATE,
  status TEXT NOT NULL DEFAULT 'available',
  source_url TEXT,
  price NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_storage_items TO authenticated;
GRANT ALL ON public.food_storage_items TO service_role;
ALTER TABLE public.food_storage_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own storage items" ON public.food_storage_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_food_storage_items_updated_at
  BEFORE UPDATE ON public.food_storage_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_food_storage_items_user ON public.food_storage_items(user_id);
CREATE INDEX idx_food_storage_items_category ON public.food_storage_items(user_id, category);