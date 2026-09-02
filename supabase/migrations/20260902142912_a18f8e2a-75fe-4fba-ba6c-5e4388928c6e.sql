CREATE TABLE public.electrical_ai_feature_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scenario text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','revoked')),
  request_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scenario)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_ai_feature_grants TO authenticated;
GRANT ALL ON public.electrical_ai_feature_grants TO service_role;

ALTER TABLE public.electrical_ai_feature_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own ai feature rows readable"
  ON public.electrical_ai_feature_grants FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "request own ai features"
  ON public.electrical_ai_feature_grants FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = auth.uid() AND status = 'pending')
    OR private.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "re-request own ai features"
  ON public.electrical_ai_feature_grants FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (
    (user_id = auth.uid() AND status = 'pending')
    OR private.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "admins remove ai feature rows"
  ON public.electrical_ai_feature_grants FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER electrical_ai_feature_grants_updated_at
  BEFORE UPDATE ON public.electrical_ai_feature_grants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();