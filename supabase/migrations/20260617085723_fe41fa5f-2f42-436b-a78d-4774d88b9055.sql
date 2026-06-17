CREATE TABLE public.livestock_animals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  species TEXT NOT NULL,
  breed TEXT,
  tag TEXT,
  sex TEXT,
  birth_date DATE,
  quantity INTEGER NOT NULL DEFAULT 1,
  purpose TEXT NOT NULL DEFAULT 'meat',
  expected_yield_lbs NUMERIC,
  yield_unit TEXT NOT NULL DEFAULT 'lbs',
  status TEXT NOT NULL DEFAULT 'active',
  location TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.livestock_animals TO authenticated;
GRANT ALL ON public.livestock_animals TO service_role;

ALTER TABLE public.livestock_animals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own livestock" ON public.livestock_animals
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own livestock" ON public.livestock_animals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own livestock" ON public.livestock_animals
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own livestock" ON public.livestock_animals
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER set_livestock_animals_updated_at
  BEFORE UPDATE ON public.livestock_animals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX livestock_animals_user_id_idx ON public.livestock_animals(user_id);