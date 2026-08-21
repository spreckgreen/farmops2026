-- Duplicate whose real task already exists and is done: drop it.
UPDATE public.activity_log SET task_id = (SELECT id FROM public.tasks WHERE slug = 'follow-up-cement')
 WHERE task_id = '7b35c9c2-8e52-4a5d-883c-45f58b4afe93';
UPDATE public.summaries SET scope_task_id = (SELECT id FROM public.tasks WHERE slug = 'follow-up-cement')
 WHERE scope_task_id = '7b35c9c2-8e52-4a5d-883c-45f58b4afe93';
UPDATE public.project_design_elements SET task_id = NULL
 WHERE task_id = '7b35c9c2-8e52-4a5d-883c-45f58b4afe93';
DELETE FROM public.tasks WHERE id = '7b35c9c2-8e52-4a5d-883c-45f58b4afe93';

-- Remaining ones have no surviving original: clean the stray "#task/<slug>"
-- text out of the title (slug stays immutable so old note refs keep resolving).
UPDATE public.tasks
   SET title = btrim(regexp_replace(title, '#task/[A-Za-z0-9-]+', '', 'g'))
 WHERE title LIKE '#task/%';