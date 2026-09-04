CREATE TABLE public.electrical_post_grid_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  post_ref text NOT NULL,
  override_grid_cell text NOT NULL,
  derived_grid_cell text,
  geometry_version text,
  reconciliation_note text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT electrical_post_grid_overrides_unique UNIQUE (user_id, post_ref),
  CONSTRAINT electrical_post_grid_overrides_cell_format
    CHECK (override_grid_cell ~ '^[A-F](-[A-F])?[1-9](-[1-9])?$'),
  CONSTRAINT electrical_post_grid_overrides_note_len
    CHECK (length(btrim(reconciliation_note)) >= 10)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_post_grid_overrides TO authenticated;
GRANT ALL ON public.electrical_post_grid_overrides TO service_role;

ALTER TABLE public.electrical_post_grid_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own post grid overrides select"
  ON public.electrical_post_grid_overrides FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Own post grid overrides insert"
  ON public.electrical_post_grid_overrides FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Own post grid overrides update"
  ON public.electrical_post_grid_overrides FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Own post grid overrides delete"
  ON public.electrical_post_grid_overrides FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "electrical_post_grid_overrides_shared_read"
  ON public.electrical_post_grid_overrides FOR SELECT TO authenticated
  USING (private.has_electrical_read(auth.uid()));

CREATE POLICY "electrical_post_grid_overrides_shared_field_update"
  ON public.electrical_post_grid_overrides FOR UPDATE TO authenticated
  USING (private.has_electrical_field_write(auth.uid()))
  WITH CHECK (private.has_electrical_field_write(auth.uid()));

CREATE TRIGGER electrical_post_grid_overrides_set_updated_at
  BEFORE UPDATE ON public.electrical_post_grid_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
