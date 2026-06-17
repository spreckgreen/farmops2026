
CREATE TABLE public.food_storage_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  category text,
  food_type text,
  pounds_per_year numeric NOT NULL DEFAULT 0,
  target_months numeric NOT NULL DEFAULT 12,
  price_per_pound numeric,
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_storage_plan TO authenticated;
GRANT ALL ON public.food_storage_plan TO service_role;

ALTER TABLE public.food_storage_plan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own storage plan rows"
  ON public.food_storage_plan FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_food_storage_plan_updated_at
  BEFORE UPDATE ON public.food_storage_plan
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_food_storage_plan_user ON public.food_storage_plan(user_id, sort_order);
