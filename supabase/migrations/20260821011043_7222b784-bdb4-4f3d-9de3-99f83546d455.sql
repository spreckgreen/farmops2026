CREATE TABLE public.task_health_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ran_at timestamp with time zone NOT NULL DEFAULT now(),
  trigger text NOT NULL DEFAULT 'scheduled',
  applied boolean NOT NULL DEFAULT false,
  scanned_tasks integer NOT NULL DEFAULT 0,
  merges jsonb NOT NULL DEFAULT '[]'::jsonb,
  merges_applied integer NOT NULL DEFAULT 0,
  title_cleanups jsonb NOT NULL DEFAULT '[]'::jsonb,
  drift jsonb NOT NULL DEFAULT '[]'::jsonb,
  drift_fixed integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.task_health_runs TO authenticated;
GRANT ALL ON public.task_health_runs TO service_role;

ALTER TABLE public.task_health_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own task health runs"
  ON public.task_health_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER task_health_runs_set_updated_at
  BEFORE UPDATE ON public.task_health_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX task_health_runs_user_ran_idx
  ON public.task_health_runs (user_id, ran_at DESC);

CREATE TABLE public.job_locks (
  name text NOT NULL PRIMARY KEY,
  locked_until timestamp with time zone,
  paused boolean NOT NULL DEFAULT false,
  paused_reason text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_run_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.job_locks TO service_role;

ALTER TABLE public.job_locks ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER job_locks_set_updated_at
  BEFORE UPDATE ON public.job_locks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();