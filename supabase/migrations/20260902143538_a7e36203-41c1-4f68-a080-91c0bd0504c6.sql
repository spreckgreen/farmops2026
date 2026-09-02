CREATE TABLE public.ai_feature_toggles (
  area text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  note text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ai_feature_toggles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ai_feature_toggles TO authenticated;
GRANT ALL ON public.ai_feature_toggles TO service_role;

ALTER TABLE public.ai_feature_toggles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_feature_toggles_read" ON public.ai_feature_toggles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ai_feature_toggles_admin_insert" ON public.ai_feature_toggles
  FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "ai_feature_toggles_admin_update" ON public.ai_feature_toggles
  FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "ai_feature_toggles_admin_delete" ON public.ai_feature_toggles
  FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER ai_feature_toggles_set_updated_at
  BEFORE UPDATE ON public.ai_feature_toggles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  area text NOT NULL,
  area_label text,
  engine_id text,
  backend text NOT NULL,
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  metered boolean NOT NULL DEFAULT false,
  estimated boolean NOT NULL DEFAULT true,
  latency_ms integer,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_events_user_created_idx ON public.ai_usage_events (user_id, created_at DESC);
CREATE INDEX ai_usage_events_created_idx ON public.ai_usage_events (created_at DESC);

GRANT SELECT, INSERT ON public.ai_usage_events TO authenticated;
GRANT ALL ON public.ai_usage_events TO service_role;

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_usage_events_select_own_or_admin" ON public.ai_usage_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "ai_usage_events_insert_own" ON public.ai_usage_events
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());