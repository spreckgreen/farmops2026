DROP POLICY IF EXISTS "Users manage their own design elements" ON public.project_design_elements;
CREATE POLICY "Users manage their own design elements"
ON public.project_design_elements
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);