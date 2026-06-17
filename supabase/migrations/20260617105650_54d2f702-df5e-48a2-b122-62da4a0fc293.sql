-- 1) Admin-only write policies on user_roles to prevent privilege escalation
CREATE POLICY "Admins insert roles"
ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins update roles"
ON public.user_roles FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins delete roles"
ON public.user_roles FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 2) Lock down the internal trigger function so it cannot be called as an RPC
REVOKE EXECUTE ON FUNCTION public.log_food_price_change() FROM PUBLIC, anon, authenticated;