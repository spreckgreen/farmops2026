CREATE POLICY "admins update own price history for restore"
ON public.food_price_history
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id AND private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (auth.uid() = user_id AND private.has_role(auth.uid(), 'admin'::public.app_role));