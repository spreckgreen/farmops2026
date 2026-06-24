CREATE POLICY "Owners can delete their activity log entries"
ON public.activity_log
FOR DELETE
TO authenticated
USING (auth.uid() = user_id AND public.can_write(auth.uid()));