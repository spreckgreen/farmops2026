
CREATE TABLE public.plant_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT '',
  season text NOT NULL DEFAULT '',
  lead text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plant_seasons TO authenticated;
GRANT ALL ON public.plant_seasons TO service_role;

ALTER TABLE public.plant_seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plant_seasons_select_own" ON public.plant_seasons
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "plant_seasons_insert_own" ON public.plant_seasons
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "plant_seasons_update_own" ON public.plant_seasons
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "plant_seasons_delete_own" ON public.plant_seasons
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER set_updated_at_plant_seasons
  BEFORE UPDATE ON public.plant_seasons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX plant_seasons_user_name_idx ON public.plant_seasons (user_id, name);
