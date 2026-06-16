
-- Helper: writer = editor OR admin
CREATE OR REPLACE FUNCTION public.can_write(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('editor','admin')
  )
$$;

-- activity_log
DROP POLICY IF EXISTS activity_log_owner_insert ON public.activity_log;
CREATE POLICY activity_log_owner_insert ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));

-- consumables
DROP POLICY IF EXISTS "Users insert own consumables" ON public.consumables;
DROP POLICY IF EXISTS "Users update own consumables" ON public.consumables;
DROP POLICY IF EXISTS "Users delete own consumables" ON public.consumables;
CREATE POLICY "Users insert own consumables" ON public.consumables
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));
CREATE POLICY "Users update own consumables" ON public.consumables
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.can_write(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));
CREATE POLICY "Users delete own consumables" ON public.consumables
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.can_write(auth.uid()));

-- daily_notes (split FOR ALL)
DROP POLICY IF EXISTS daily_notes_owner_all ON public.daily_notes;
CREATE POLICY daily_notes_owner_select ON public.daily_notes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY daily_notes_owner_insert ON public.daily_notes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));
CREATE POLICY daily_notes_owner_update ON public.daily_notes
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.can_write(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));
CREATE POLICY daily_notes_owner_delete ON public.daily_notes
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.can_write(auth.uid()));

-- inventory_items
DROP POLICY IF EXISTS "Users insert own inventory" ON public.inventory_items;
DROP POLICY IF EXISTS "Users update own inventory" ON public.inventory_items;
DROP POLICY IF EXISTS "Users delete own inventory" ON public.inventory_items;
CREATE POLICY "Users insert own inventory" ON public.inventory_items
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));
CREATE POLICY "Users update own inventory" ON public.inventory_items
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.can_write(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));
CREATE POLICY "Users delete own inventory" ON public.inventory_items
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.can_write(auth.uid()));

-- maintenance_records
DROP POLICY IF EXISTS maintenance_owner_insert ON public.maintenance_records;
DROP POLICY IF EXISTS maintenance_owner_update ON public.maintenance_records;
DROP POLICY IF EXISTS maintenance_owner_delete ON public.maintenance_records;
CREATE POLICY maintenance_owner_insert ON public.maintenance_records
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));
CREATE POLICY maintenance_owner_update ON public.maintenance_records
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.can_write(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));
CREATE POLICY maintenance_owner_delete ON public.maintenance_records
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.can_write(auth.uid()));

-- projects (split FOR ALL)
DROP POLICY IF EXISTS projects_owner_all ON public.projects;
CREATE POLICY projects_owner_select ON public.projects
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY projects_owner_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));
CREATE POLICY projects_owner_update ON public.projects
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.can_write(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));
CREATE POLICY projects_owner_delete ON public.projects
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.can_write(auth.uid()));

-- summaries (split FOR ALL)
DROP POLICY IF EXISTS summaries_owner_all ON public.summaries;
CREATE POLICY summaries_owner_select ON public.summaries
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY summaries_owner_insert ON public.summaries
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));
CREATE POLICY summaries_owner_update ON public.summaries
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.can_write(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));
CREATE POLICY summaries_owner_delete ON public.summaries
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.can_write(auth.uid()));

-- tasks (split FOR ALL)
DROP POLICY IF EXISTS tasks_owner_all ON public.tasks;
CREATE POLICY tasks_owner_select ON public.tasks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY tasks_owner_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));
CREATE POLICY tasks_owner_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.can_write(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));
CREATE POLICY tasks_owner_delete ON public.tasks
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.can_write(auth.uid()));
