GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.summaries TO authenticated;
GRANT ALL ON public.summaries TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_notes TO authenticated;
GRANT ALL ON public.daily_notes TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_records TO authenticated;
GRANT ALL ON public.maintenance_records TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consumables TO authenticated;
GRANT ALL ON public.consumables TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_items TO authenticated;
GRANT ALL ON public.inventory_items TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crop_harvests TO authenticated;
GRANT ALL ON public.crop_harvests TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crop_plantings TO authenticated;
GRANT ALL ON public.crop_plantings TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.garden_plots TO authenticated;
GRANT ALL ON public.garden_plots TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orchard_trees TO authenticated;
GRANT ALL ON public.orchard_trees TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.livestock_animals TO authenticated;
GRANT ALL ON public.livestock_animals TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plant_seasons TO authenticated;
GRANT ALL ON public.plant_seasons TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_storage_items TO authenticated;
GRANT ALL ON public.food_storage_items TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_storage_plan TO authenticated;
GRANT ALL ON public.food_storage_plan TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_plan_entries TO authenticated;
GRANT ALL ON public.food_plan_entries TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_plan_foods TO authenticated;
GRANT ALL ON public.food_plan_foods TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_plan_people TO authenticated;
GRANT ALL ON public.food_plan_people TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_price_history TO authenticated;
GRANT ALL ON public.food_price_history TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.procedures TO authenticated;
GRANT ALL ON public.procedures TO service_role;