INSERT INTO public.app_addons (key, name, description, active, sort_order)
VALUES (
  'electrical_fieldwrite',
  'Electrical (field write)',
  'Write access to the electrician-viewable Electrical screens (panels, raceways, junction boxes, branch runs, circuits, loads, services, labels). Excludes the reconciliation tools. Every change is recorded in the electrical change audit for administrator review.',
  true,
  30
)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      active = true,
      sort_order = EXCLUDED.sort_order;

CREATE TABLE public.electrical_change_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_email text,
  section text NOT NULL,
  entity_kind text NOT NULL,
  entity_uuid uuid,
  entity_ref text,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  summary text,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  access_basis text,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX electrical_change_audit_created_idx ON public.electrical_change_audit (created_at DESC);
CREATE INDEX electrical_change_audit_user_idx ON public.electrical_change_audit (user_id, created_at DESC);
CREATE INDEX electrical_change_audit_unreviewed_idx ON public.electrical_change_audit (reviewed_at) WHERE reviewed_at IS NULL;

GRANT SELECT, INSERT ON public.electrical_change_audit TO authenticated;
GRANT UPDATE (reviewed_at, reviewed_by, review_note, updated_at) ON public.electrical_change_audit TO authenticated;
GRANT ALL ON public.electrical_change_audit TO service_role;

ALTER TABLE public.electrical_change_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_insert_own" ON public.electrical_change_audit
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND reviewed_at IS NULL AND reviewed_by IS NULL);

CREATE POLICY "audit_select_own" ON public.electrical_change_audit
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "audit_select_admin" ON public.electrical_change_audit
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "audit_review_admin" ON public.electrical_change_audit
  FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER electrical_change_audit_set_updated_at
  BEFORE UPDATE ON public.electrical_change_audit
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
