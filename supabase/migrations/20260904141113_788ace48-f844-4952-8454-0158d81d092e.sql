CREATE TABLE public.user_ui_preferences (
  user_id uuid PRIMARY KEY,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ui_preferences TO authenticated;
GRANT ALL ON public.user_ui_preferences TO service_role;

ALTER TABLE public.user_ui_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own ui preferences" ON public.user_ui_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own ui preferences" ON public.user_ui_preferences
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own ui preferences" ON public.user_ui_preferences
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own ui preferences" ON public.user_ui_preferences
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER user_ui_preferences_set_updated_at
  BEFORE UPDATE ON public.user_ui_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();