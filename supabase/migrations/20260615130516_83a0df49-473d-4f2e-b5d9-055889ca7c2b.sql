ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recurrence_next_at timestamptz;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_recurrence_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_recurrence_check CHECK (recurrence IN ('none','daily','weekly','monthly','quarterly','yearly'));
CREATE INDEX IF NOT EXISTS tasks_recurrence_idx ON public.tasks(recurrence) WHERE recurrence <> 'none';