CREATE TABLE public.electrical_audit_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id text NOT NULL UNIQUE,
  schema_version text NOT NULL DEFAULT 'farmops.electrical.audit-batch.v1',
  title text NOT NULL,
  scope text,
  building text,
  observed_date date,
  observed_time_precision text,
  timezone text,
  source text,
  manifest_sha256 text NOT NULL,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_statement text,
  approval_reason text,
  compensates_batch_id text,
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamp with time zone,
  applied_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT electrical_audit_batches_status_check CHECK (
    status IN ('draft','validated','approved','partially_applied','applied','rejected')
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_audit_batches TO authenticated;
GRANT ALL ON public.electrical_audit_batches TO service_role;
ALTER TABLE public.electrical_audit_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_batches_select_own_or_admin" ON public.electrical_audit_batches
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "audit_batches_insert_own" ON public.electrical_audit_batches
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "audit_batches_update_own_or_admin" ON public.electrical_audit_batches
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (created_by = auth.uid() OR private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "audit_batches_delete_own_or_admin" ON public.electrical_audit_batches
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR private.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.electrical_audit_batch_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_uuid uuid NOT NULL REFERENCES public.electrical_audit_batches(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  entity_kind text NOT NULL,
  target_stable_id text,
  observation_class text NOT NULL,
  operation text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_updated_at timestamp with time zone,
  preview_before jsonb,
  preview_after jsonb,
  disposition text NOT NULL DEFAULT 'hold',
  validation_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved boolean NOT NULL DEFAULT false,
  applied_at timestamp with time zone,
  applied_row_uuid uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT electrical_audit_batch_items_unique UNIQUE (batch_uuid, item_key),
  CONSTRAINT electrical_audit_batch_items_disposition_check CHECK (
    disposition IN ('ready','no_change','hold','conflict','ods_candidate','applied','failed')
  ),
  CONSTRAINT electrical_audit_batch_items_operation_check CHECK (
    operation IN ('CREATE','UPDATE','LINK','NO_CHANGE','HOLD_UNRESOLVED','CONFLICT','ODS_CORRECTION_CANDIDATE')
  ),
  CONSTRAINT electrical_audit_batch_items_class_check CHECK (
    observation_class IN ('FIELD_AS_BUILT','ROUGH_IN','TEMPORARY','PLANNED_DESIGN','PROPOSED_RESEARCH','HOLD_UNRESOLVED')
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_audit_batch_items TO authenticated;
GRANT ALL ON public.electrical_audit_batch_items TO service_role;
ALTER TABLE public.electrical_audit_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_batch_items_select_own_or_admin" ON public.electrical_audit_batch_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.electrical_audit_batches b
    WHERE b.id = batch_uuid
      AND (b.created_by = auth.uid() OR private.has_role(auth.uid(), 'admin'::app_role))
  ));
CREATE POLICY "audit_batch_items_insert_own_or_admin" ON public.electrical_audit_batch_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.electrical_audit_batches b
    WHERE b.id = batch_uuid
      AND (b.created_by = auth.uid() OR private.has_role(auth.uid(), 'admin'::app_role))
  ));
CREATE POLICY "audit_batch_items_update_own_or_admin" ON public.electrical_audit_batch_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.electrical_audit_batches b
    WHERE b.id = batch_uuid
      AND (b.created_by = auth.uid() OR private.has_role(auth.uid(), 'admin'::app_role))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.electrical_audit_batches b
    WHERE b.id = batch_uuid
      AND (b.created_by = auth.uid() OR private.has_role(auth.uid(), 'admin'::app_role))
  ));
CREATE POLICY "audit_batch_items_delete_own_or_admin" ON public.electrical_audit_batch_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.electrical_audit_batches b
    WHERE b.id = batch_uuid
      AND (b.created_by = auth.uid() OR private.has_role(auth.uid(), 'admin'::app_role))
  ));

CREATE INDEX electrical_audit_batch_items_batch_idx
  ON public.electrical_audit_batch_items (batch_uuid);

CREATE TRIGGER electrical_audit_batches_updated_at
  BEFORE UPDATE ON public.electrical_audit_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER electrical_audit_batch_items_updated_at
  BEFORE UPDATE ON public.electrical_audit_batch_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.electrical_loads
  ADD COLUMN IF NOT EXISTS pole_scheme text,
  ADD COLUMN IF NOT EXISTS pole_location_kind text,
  ADD COLUMN IF NOT EXISTS pole_ref_start text,
  ADD COLUMN IF NOT EXISTS pole_ref_end text,
  ADD COLUMN IF NOT EXISTS field_grid_reference text;

ALTER TABLE public.electrical_panels
  ADD COLUMN IF NOT EXISTS pole_scheme text,
  ADD COLUMN IF NOT EXISTS pole_location_kind text,
  ADD COLUMN IF NOT EXISTS pole_ref_start text,
  ADD COLUMN IF NOT EXISTS pole_ref_end text,
  ADD COLUMN IF NOT EXISTS field_grid_reference text;

ALTER TABLE public.electrical_junction_boxes
  ADD COLUMN IF NOT EXISTS pole_scheme text,
  ADD COLUMN IF NOT EXISTS pole_location_kind text,
  ADD COLUMN IF NOT EXISTS pole_ref_start text,
  ADD COLUMN IF NOT EXISTS pole_ref_end text,
  ADD COLUMN IF NOT EXISTS field_grid_reference text;