
CREATE TABLE public.food_plan_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_plan_people TO authenticated;
GRANT ALL ON public.food_plan_people TO service_role;
ALTER TABLE public.food_plan_people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own people select" ON public.food_plan_people FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own people insert" ON public.food_plan_people FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own people update" ON public.food_plan_people FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own people delete" ON public.food_plan_people FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER food_plan_people_updated_at BEFORE UPDATE ON public.food_plan_people FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.food_plan_foods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  season text,
  meal text,
  freeze_dry boolean NOT NULL DEFAULT false,
  price_per_pound numeric,
  oz_per_serving numeric,
  unit text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_plan_foods TO authenticated;
GRANT ALL ON public.food_plan_foods TO service_role;
ALTER TABLE public.food_plan_foods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own foods select" ON public.food_plan_foods FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own foods insert" ON public.food_plan_foods FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own foods update" ON public.food_plan_foods FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own foods delete" ON public.food_plan_foods FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER food_plan_foods_updated_at BEFORE UPDATE ON public.food_plan_foods FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.food_plan_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.food_plan_people(id) ON DELETE CASCADE,
  food_id uuid NOT NULL REFERENCES public.food_plan_foods(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  quantity numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, person_id, food_id, day_of_week)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_plan_entries TO authenticated;
GRANT ALL ON public.food_plan_entries TO service_role;
ALTER TABLE public.food_plan_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own entries select" ON public.food_plan_entries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own entries insert" ON public.food_plan_entries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own entries update" ON public.food_plan_entries FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own entries delete" ON public.food_plan_entries FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER food_plan_entries_updated_at BEFORE UPDATE ON public.food_plan_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX food_plan_entries_user_idx ON public.food_plan_entries(user_id);
CREATE INDEX food_plan_entries_person_idx ON public.food_plan_entries(person_id);
CREATE INDEX food_plan_entries_food_idx ON public.food_plan_entries(food_id);
