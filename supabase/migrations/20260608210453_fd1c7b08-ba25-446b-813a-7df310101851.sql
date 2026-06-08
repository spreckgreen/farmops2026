ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS percent_complete smallint NOT NULL DEFAULT 0
  CHECK (percent_complete >= 0 AND percent_complete <= 100);

DROP TRIGGER IF EXISTS tasks_set_updated_at ON public.tasks;
CREATE TRIGGER tasks_set_updated_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();