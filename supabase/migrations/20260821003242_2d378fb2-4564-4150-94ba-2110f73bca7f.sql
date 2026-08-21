DO $$
DECLARE
  d RECORD;
  ref text;
  target public.tasks;
  hops int;
BEGIN
  FOR d IN
    SELECT * FROM public.tasks
    WHERE title LIKE '#task/%'
  LOOP
    ref := lower(substring(d.title from '^#task/([A-Za-z0-9-]+)'));
    hops := 0;
    target := NULL;
    LOOP
      hops := hops + 1;
      SELECT * INTO target FROM public.tasks
       WHERE user_id = d.user_id AND slug = ref AND id <> d.id;
      EXIT WHEN target IS NULL OR target.title NOT LIKE '#task/%' OR hops > 5;
      ref := lower(substring(target.title from '^#task/([A-Za-z0-9-]+)'));
    END LOOP;

    IF target.id IS NULL THEN
      CONTINUE;
    END IF;

    -- Carry the completion from the duplicate onto the real task.
    IF d.status = 'done' AND target.status <> 'done' THEN
      UPDATE public.tasks
         SET status = 'done',
             closed_at = COALESCE(d.closed_at, now()),
             percent_complete = 100
       WHERE id = target.id;
    END IF;

    -- Repoint dependents, then drop the duplicate.
    UPDATE public.activity_log SET task_id = target.id WHERE task_id = d.id;
    UPDATE public.summaries SET scope_task_id = target.id WHERE scope_task_id = d.id;
    UPDATE public.project_design_elements SET task_id = target.id
     WHERE task_id = d.id
       AND NOT EXISTS (SELECT 1 FROM public.project_design_elements p2
                        WHERE p2.task_id = target.id AND p2.id <> project_design_elements.id);
    UPDATE public.project_design_elements SET task_id = NULL WHERE task_id = d.id;
    DELETE FROM public.tasks WHERE id = d.id;
  END LOOP;
END $$;