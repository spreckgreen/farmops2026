ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS project_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS start_at timestamptz;

CREATE INDEX IF NOT EXISTS tasks_project_tags_idx ON public.tasks USING gin (project_tags);
CREATE INDEX IF NOT EXISTS tasks_start_at_idx ON public.tasks (start_at);