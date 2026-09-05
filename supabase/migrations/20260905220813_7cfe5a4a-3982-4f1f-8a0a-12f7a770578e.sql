ALTER TABLE public.job_locks
  ADD COLUMN IF NOT EXISTS auto_resume_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_pause_count integer NOT NULL DEFAULT 0;