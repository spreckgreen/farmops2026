
CREATE TABLE public.project_design_elements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  weight NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (weight >= 0 AND weight <= 100),
  completed BOOLEAN NOT NULL DEFAULT false,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX project_design_elements_project_idx
  ON public.project_design_elements(project_id, sort_order);
CREATE INDEX project_design_elements_user_idx
  ON public.project_design_elements(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_design_elements TO authenticated;
GRANT ALL ON public.project_design_elements TO service_role;

ALTER TABLE public.project_design_elements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own design elements"
  ON public.project_design_elements FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER project_design_elements_set_updated_at
  BEFORE UPDATE ON public.project_design_elements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
