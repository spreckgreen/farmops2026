
ALTER POLICY activity_log_owner_insert ON public.activity_log TO authenticated;
ALTER POLICY activity_log_owner_select ON public.activity_log TO authenticated;
ALTER POLICY daily_notes_owner_all ON public.daily_notes TO authenticated;
ALTER POLICY maintenance_owner_delete ON public.maintenance_records TO authenticated;
ALTER POLICY maintenance_owner_insert ON public.maintenance_records TO authenticated;
ALTER POLICY maintenance_owner_select ON public.maintenance_records TO authenticated;
ALTER POLICY maintenance_owner_update ON public.maintenance_records TO authenticated;
ALTER POLICY projects_owner_all ON public.projects TO authenticated;
ALTER POLICY summaries_owner_all ON public.summaries TO authenticated;
ALTER POLICY tasks_owner_all ON public.tasks TO authenticated;
