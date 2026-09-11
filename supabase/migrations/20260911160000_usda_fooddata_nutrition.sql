-- USDA FoodData Central reference cache and reviewed FarmOps food links.
-- Reference rows are immutable to browser clients; only trusted server/import
-- code using the service role may populate them.

CREATE TABLE IF NOT EXISTS public.usda_fdc_foods (
  fdc_id bigint PRIMARY KEY,
  description text NOT NULL,
  data_type text NOT NULL,
  food_category text,
  publication_date date,
  brand_owner text,
  ingredients text,
  nutrients jsonb NOT NULL DEFAULT '[]'::jsonb,
  portions jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_payload jsonb NOT NULL,
  source_release text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usda_fdc_foods_nutrients_array CHECK (jsonb_typeof(nutrients) = 'array'),
  CONSTRAINT usda_fdc_foods_portions_array CHECK (jsonb_typeof(portions) = 'array')
);

CREATE INDEX IF NOT EXISTS usda_fdc_foods_description_idx
  ON public.usda_fdc_foods USING gin (to_tsvector('english', description));
CREATE INDEX IF NOT EXISTS usda_fdc_foods_data_type_idx
  ON public.usda_fdc_foods (data_type);

ALTER TABLE public.usda_fdc_foods ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.usda_fdc_foods TO authenticated;
GRANT ALL ON public.usda_fdc_foods TO service_role;

DROP POLICY IF EXISTS "authenticated can read USDA reference foods" ON public.usda_fdc_foods;
CREATE POLICY "authenticated can read USDA reference foods"
  ON public.usda_fdc_foods FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.food_nutrient_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_id uuid NOT NULL REFERENCES public.food_plan_foods(id) ON DELETE CASCADE,
  fdc_id bigint NOT NULL REFERENCES public.usda_fdc_foods(fdc_id) ON DELETE RESTRICT,
  food_form text NOT NULL DEFAULT 'As listed',
  serving_amount numeric,
  serving_unit text,
  serving_grams numeric,
  match_status text NOT NULL DEFAULT 'approved',
  match_method text NOT NULL DEFAULT 'manual_review',
  notes text,
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT food_nutrient_profiles_form_not_blank CHECK (btrim(food_form) <> ''),
  CONSTRAINT food_nutrient_profiles_serving_amount_positive CHECK (serving_amount IS NULL OR serving_amount > 0),
  CONSTRAINT food_nutrient_profiles_serving_grams_positive CHECK (serving_grams IS NULL OR serving_grams > 0),
  CONSTRAINT food_nutrient_profiles_match_status CHECK (match_status IN ('proposed', 'approved', 'rejected', 'replaced')),
  CONSTRAINT food_nutrient_profiles_match_method CHECK (match_method IN ('manual_review', 'download_match', 'api_search')),
  UNIQUE (user_id, food_id, food_form)
);

CREATE INDEX IF NOT EXISTS food_nutrient_profiles_food_idx
  ON public.food_nutrient_profiles (user_id, food_id);

ALTER TABLE public.food_nutrient_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_nutrient_profiles TO authenticated;
GRANT ALL ON public.food_nutrient_profiles TO service_role;

DROP POLICY IF EXISTS "own nutrient profiles select" ON public.food_nutrient_profiles;
CREATE POLICY "own nutrient profiles select" ON public.food_nutrient_profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own nutrient profiles insert" ON public.food_nutrient_profiles;
CREATE POLICY "own nutrient profiles insert" ON public.food_nutrient_profiles
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id AND EXISTS (
      SELECT 1 FROM public.food_plan_foods f
      WHERE f.id = food_id AND f.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "own nutrient profiles update" ON public.food_nutrient_profiles;
CREATE POLICY "own nutrient profiles update" ON public.food_nutrient_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id AND EXISTS (
      SELECT 1 FROM public.food_plan_foods f
      WHERE f.id = food_id AND f.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "own nutrient profiles delete" ON public.food_nutrient_profiles;
CREATE POLICY "own nutrient profiles delete" ON public.food_nutrient_profiles
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

COMMENT ON TABLE public.usda_fdc_foods IS
  'Local, server-managed mirror/cache of USDA FoodData Central records.';
COMMENT ON TABLE public.food_nutrient_profiles IS
  'Explicitly reviewed links between a user food/form and an immutable USDA FDC reference record.';
