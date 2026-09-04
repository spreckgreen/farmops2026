CREATE TABLE public.electrical_peer_sync_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  peer_base_url text NOT NULL,
  run_as_user_id uuid NOT NULL,
  max_batches_per_run integer NOT NULL DEFAULT 5,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_result jsonb,
  batches_staged_total integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_peer_sync_config TO authenticated;
GRANT ALL ON public.electrical_peer_sync_config TO service_role;

ALTER TABLE public.electrical_peer_sync_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read peer sync config"
  ON public.electrical_peer_sync_config FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins create peer sync config"
  ON public.electrical_peer_sync_config FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update peer sync config"
  ON public.electrical_peer_sync_config FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete peer sync config"
  ON public.electrical_peer_sync_config FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER set_electrical_peer_sync_config_updated_at
  BEFORE UPDATE ON public.electrical_peer_sync_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.job_locks (name) VALUES ('electrical-peer-sync')
  ON CONFLICT (name) DO NOTHING;