ALTER TABLE public.electrical_panel_edit_requests
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'panel_edit';

ALTER TABLE public.electrical_panel_edit_requests
  DROP CONSTRAINT IF EXISTS electrical_panel_edit_requests_scope_check;

ALTER TABLE public.electrical_panel_edit_requests
  ADD CONSTRAINT electrical_panel_edit_requests_scope_check
  CHECK (scope IN ('panel_edit', 'system_data'));

CREATE INDEX IF NOT EXISTS electrical_panel_edit_requests_scope_idx
  ON public.electrical_panel_edit_requests (requester_id, scope, panel_id);