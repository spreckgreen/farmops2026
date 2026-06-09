ALTER TABLE public.summaries ADD COLUMN IF NOT EXISTS scope_project text;
CREATE INDEX IF NOT EXISTS summaries_scope_project_idx ON public.summaries (user_id, mode, scope_project, created_at DESC);