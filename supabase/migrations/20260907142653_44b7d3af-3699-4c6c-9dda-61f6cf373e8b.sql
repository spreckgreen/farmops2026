CREATE TABLE public.task_print_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_print_grants TO authenticated;
GRANT ALL ON public.task_print_grants TO service_role;

ALTER TABLE public.task_print_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see their own planner print grant"
ON public.task_print_grants FOR SELECT TO authenticated
USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can grant planner printing"
ON public.task_print_grants FOR INSERT TO authenticated
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update planner print grants"
ON public.task_print_grants FOR UPDATE TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can revoke planner print grants"
ON public.task_print_grants FOR DELETE TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER task_print_grants_set_updated_at
BEFORE UPDATE ON public.task_print_grants
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();