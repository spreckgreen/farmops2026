CREATE TABLE public.ai_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  surface text NOT NULL,
  plan jsonb NOT NULL,
  result jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.ai_action_log TO authenticated;
GRANT ALL ON public.ai_action_log TO service_role;
ALTER TABLE public.ai_action_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_action_log_own" ON public.ai_action_log
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX ai_action_log_user_created_idx ON public.ai_action_log (user_id, created_at DESC);