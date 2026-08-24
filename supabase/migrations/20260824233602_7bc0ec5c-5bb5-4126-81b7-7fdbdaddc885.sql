-- plant_seasons: owner-scoped delete (app deletes own season rows)
DROP POLICY IF EXISTS "plant_seasons_delete_own" ON public.plant_seasons;
CREATE POLICY "plant_seasons_delete_own"
ON public.plant_seasons FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- food_price_history: owner-scoped update so users can correct their own rows
DROP POLICY IF EXISTS "food_price_history_update_own" ON public.food_price_history;
CREATE POLICY "food_price_history_update_own"
ON public.food_price_history FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);