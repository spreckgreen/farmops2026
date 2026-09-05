ALTER TABLE public.electrical_audit_batch_items
  DROP CONSTRAINT IF EXISTS electrical_audit_batch_items_class_check;

ALTER TABLE public.electrical_audit_batch_items
  ADD CONSTRAINT electrical_audit_batch_items_class_check
  CHECK (observation_class = ANY (ARRAY[
    'FIELD_AS_BUILT'::text,
    'ROUGH_IN'::text,
    'TEMPORARY'::text,
    'PLANNED_DESIGN'::text,
    'APPROVED_PLANNED_DESIGN'::text,
    'PROPOSED_RESEARCH'::text,
    'HOLD_UNRESOLVED'::text
  ]));