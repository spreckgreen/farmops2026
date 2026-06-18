ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS design_element_id uuid REFERENCES public.project_design_elements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_design_element_id ON public.tasks(design_element_id);