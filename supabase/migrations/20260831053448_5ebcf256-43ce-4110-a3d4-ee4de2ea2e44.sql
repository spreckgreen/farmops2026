ALTER TABLE public.electrical_field_observations
  ADD COLUMN IF NOT EXISTS scope text,
  ADD COLUMN IF NOT EXISTS apply_status text,
  ADD COLUMN IF NOT EXISTS applied_value text,
  ADD COLUMN IF NOT EXISTS applied_previous_value text,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

COMMENT ON COLUMN public.electrical_field_observations.apply_status IS
  'Outcome of the FarmOps write for this evidence row: changed, already_correct, drifted, not_found, failed, not_applied.';

CREATE INDEX IF NOT EXISTS electrical_field_observations_journal_idx
  ON public.electrical_field_observations (user_id, created_at DESC);
