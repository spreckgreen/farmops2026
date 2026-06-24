CREATE POLICY "Owners can update their activity log entries"
ON public.activity_log
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id AND public.can_write(auth.uid()))
WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));