INSERT INTO public.task_print_grants (user_id, granted_by, note)
SELECT u.id,
       (SELECT id FROM auth.users WHERE email = 'rpremo@live.com'),
       'Premium print package granted by owner request'
FROM auth.users u
WHERE u.email IN ('rpremo@live.com', 'rpremooak@gmail.com', 'bosteadfarms@gmail.com')
  AND NOT EXISTS (SELECT 1 FROM public.task_print_grants g WHERE g.user_id = u.id);