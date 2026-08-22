CREATE TABLE public.inventory_import_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name text NOT NULL DEFAULT '',
  delete_missing boolean NOT NULL DEFAULT false,
  created_ids uuid[] NOT NULL DEFAULT '{}',
  updated_before jsonb NOT NULL DEFAULT '[]'::jsonb,
  deleted_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  reverted_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_import_snapshots TO authenticated;
GRANT ALL ON public.inventory_import_snapshots TO service_role;

ALTER TABLE public.inventory_import_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own import snapshots"
  ON public.inventory_import_snapshots FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own import snapshots"
  ON public.inventory_import_snapshots FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own import snapshots"
  ON public.inventory_import_snapshots FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own import snapshots"
  ON public.inventory_import_snapshots FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX inventory_import_snapshots_user_created_idx
  ON public.inventory_import_snapshots (user_id, created_at DESC);

CREATE TRIGGER inventory_import_snapshots_set_updated_at
  BEFORE UPDATE ON public.inventory_import_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();