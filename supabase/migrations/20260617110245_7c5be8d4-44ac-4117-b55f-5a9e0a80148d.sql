
-- food_plan_entries
DROP POLICY "own entries delete" ON public.food_plan_entries;
DROP POLICY "own entries insert" ON public.food_plan_entries;
DROP POLICY "own entries select" ON public.food_plan_entries;
DROP POLICY "own entries update" ON public.food_plan_entries;
CREATE POLICY "own entries select" ON public.food_plan_entries FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own entries insert" ON public.food_plan_entries FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own entries update" ON public.food_plan_entries FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own entries delete" ON public.food_plan_entries FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- food_plan_foods
DROP POLICY "own foods delete" ON public.food_plan_foods;
DROP POLICY "own foods insert" ON public.food_plan_foods;
DROP POLICY "own foods select" ON public.food_plan_foods;
DROP POLICY "own foods update" ON public.food_plan_foods;
CREATE POLICY "own foods select" ON public.food_plan_foods FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own foods insert" ON public.food_plan_foods FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own foods update" ON public.food_plan_foods FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own foods delete" ON public.food_plan_foods FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- food_plan_people
DROP POLICY "own people delete" ON public.food_plan_people;
DROP POLICY "own people insert" ON public.food_plan_people;
DROP POLICY "own people select" ON public.food_plan_people;
DROP POLICY "own people update" ON public.food_plan_people;
CREATE POLICY "own people select" ON public.food_plan_people FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own people insert" ON public.food_plan_people FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own people update" ON public.food_plan_people FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own people delete" ON public.food_plan_people FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- food_storage_items
DROP POLICY "Users manage own storage items" ON public.food_storage_items;
CREATE POLICY "Users manage own storage items" ON public.food_storage_items FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- food_storage_plan
DROP POLICY "Users manage own storage plan rows" ON public.food_storage_plan;
CREATE POLICY "Users manage own storage plan rows" ON public.food_storage_plan FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- livestock_animals
DROP POLICY "Users delete own livestock" ON public.livestock_animals;
DROP POLICY "Users insert own livestock" ON public.livestock_animals;
DROP POLICY "Users select own livestock" ON public.livestock_animals;
DROP POLICY "Users update own livestock" ON public.livestock_animals;
CREATE POLICY "Users select own livestock" ON public.livestock_animals FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own livestock" ON public.livestock_animals FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own livestock" ON public.livestock_animals FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own livestock" ON public.livestock_animals FOR DELETE TO authenticated USING (auth.uid() = user_id);
