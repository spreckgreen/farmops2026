CREATE TABLE public.procedure_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  procedure_id uuid NOT NULL REFERENCES public.procedures(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  maintenance_record_id uuid REFERENCES public.maintenance_records(id) ON DELETE CASCADE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT procedure_links_target_chk CHECK (
    (inventory_item_id IS NOT NULL)::int + (maintenance_record_id IS NOT NULL)::int = 1
  )
);

CREATE UNIQUE INDEX procedure_links_uniq_inv ON public.procedure_links (procedure_id, inventory_item_id) WHERE inventory_item_id IS NOT NULL;
CREATE UNIQUE INDEX procedure_links_uniq_maint ON public.procedure_links (procedure_id, maintenance_record_id) WHERE maintenance_record_id IS NOT NULL;
CREATE INDEX procedure_links_user_idx ON public.procedure_links (user_id);
CREATE INDEX procedure_links_inv_idx ON public.procedure_links (inventory_item_id);
CREATE INDEX procedure_links_maint_idx ON public.procedure_links (maintenance_record_id);
CREATE INDEX procedure_links_proc_idx ON public.procedure_links (procedure_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.procedure_links TO authenticated;
GRANT ALL ON public.procedure_links TO service_role;

ALTER TABLE public.procedure_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "procedure_links_select_own" ON public.procedure_links
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "procedure_links_insert_own" ON public.procedure_links
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "procedure_links_update_own" ON public.procedure_links
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "procedure_links_delete_own" ON public.procedure_links
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER procedure_links_set_updated_at BEFORE UPDATE ON public.procedure_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();