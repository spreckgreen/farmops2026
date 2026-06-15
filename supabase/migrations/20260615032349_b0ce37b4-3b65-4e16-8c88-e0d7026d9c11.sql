CREATE TABLE public.maintenance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  asset_name text,
  service_type text,
  status text,
  performed_at date,
  due_at date,
  cost numeric,
  vendor text,
  notes text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_records TO authenticated;
GRANT ALL ON public.maintenance_records TO service_role;

ALTER TABLE public.maintenance_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "maintenance_owner_select" ON public.maintenance_records
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "maintenance_owner_insert" ON public.maintenance_records
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "maintenance_owner_update" ON public.maintenance_records
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "maintenance_owner_delete" ON public.maintenance_records
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX maintenance_records_user_idx ON public.maintenance_records(user_id, performed_at DESC);

CREATE TRIGGER maintenance_records_set_updated_at
  BEFORE UPDATE ON public.maintenance_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();