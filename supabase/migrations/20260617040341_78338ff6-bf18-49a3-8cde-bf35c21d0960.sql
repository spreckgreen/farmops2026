-- ============================================================
-- Food Production · crops & harvests
-- ============================================================

-- ---------- crop_plantings ----------
CREATE TABLE public.crop_plantings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  crop text NOT NULL,
  variety text NULL,
  area text NULL,
  planted_on date NULL,
  expected_harvest date NULL,
  status text NOT NULL DEFAULT 'planned',
  notes text NULL DEFAULT '',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crop_plantings TO authenticated;
GRANT ALL ON public.crop_plantings TO service_role;

ALTER TABLE public.crop_plantings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crop_plantings_select_own"
  ON public.crop_plantings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "crop_plantings_insert_own"
  ON public.crop_plantings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "crop_plantings_update_own"
  ON public.crop_plantings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "crop_plantings_delete_own"
  ON public.crop_plantings FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER crop_plantings_set_updated_at
  BEFORE UPDATE ON public.crop_plantings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX crop_plantings_user_idx ON public.crop_plantings (user_id, planted_on DESC NULLS LAST);
CREATE INDEX crop_plantings_status_idx ON public.crop_plantings (user_id, status);

-- ---------- crop_harvests ----------
CREATE TABLE public.crop_harvests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  planting_id uuid NULL REFERENCES public.crop_plantings(id) ON DELETE SET NULL,
  harvested_on date NOT NULL DEFAULT CURRENT_DATE,
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'lbs',
  quality text NULL,
  notes text NULL DEFAULT '',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crop_harvests TO authenticated;
GRANT ALL ON public.crop_harvests TO service_role;

ALTER TABLE public.crop_harvests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crop_harvests_select_own"
  ON public.crop_harvests FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "crop_harvests_insert_own"
  ON public.crop_harvests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "crop_harvests_update_own"
  ON public.crop_harvests FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "crop_harvests_delete_own"
  ON public.crop_harvests FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER crop_harvests_set_updated_at
  BEFORE UPDATE ON public.crop_harvests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX crop_harvests_user_idx ON public.crop_harvests (user_id, harvested_on DESC);
CREATE INDEX crop_harvests_planting_idx ON public.crop_harvests (planting_id);