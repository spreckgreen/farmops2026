
CREATE TABLE public.garden_plots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  row_label text NOT NULL,
  position int NOT NULL,
  plant_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, row_label, position)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.garden_plots TO authenticated;
GRANT ALL ON public.garden_plots TO service_role;
ALTER TABLE public.garden_plots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own garden_plots select" ON public.garden_plots FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own garden_plots insert" ON public.garden_plots FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own garden_plots update" ON public.garden_plots FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own garden_plots delete" ON public.garden_plots FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER garden_plots_updated_at BEFORE UPDATE ON public.garden_plots FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX garden_plots_user_idx ON public.garden_plots (user_id);

CREATE TABLE public.orchard_trees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  species text NOT NULL,
  variety text,
  quantity int NOT NULL DEFAULT 1,
  location text,
  planted_on date,
  status text NOT NULL DEFAULT 'healthy',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orchard_trees TO authenticated;
GRANT ALL ON public.orchard_trees TO service_role;
ALTER TABLE public.orchard_trees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own orchard_trees select" ON public.orchard_trees FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own orchard_trees insert" ON public.orchard_trees FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own orchard_trees update" ON public.orchard_trees FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own orchard_trees delete" ON public.orchard_trees FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER orchard_trees_updated_at BEFORE UPDATE ON public.orchard_trees FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX orchard_trees_user_idx ON public.orchard_trees (user_id);
