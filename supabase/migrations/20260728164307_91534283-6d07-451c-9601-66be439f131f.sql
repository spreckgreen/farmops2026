CREATE TABLE public.ai_job_idempotency (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  surface text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','done','error')),
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, surface, request_hash)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_job_idempotency TO authenticated;
GRANT ALL ON public.ai_job_idempotency TO service_role;

ALTER TABLE public.ai_job_idempotency ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows select" ON public.ai_job_idempotency
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own rows insert" ON public.ai_job_idempotency
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own rows update" ON public.ai_job_idempotency
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own rows delete" ON public.ai_job_idempotency
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX ai_job_idempotency_lookup_idx
  ON public.ai_job_idempotency (user_id, surface, request_hash);
CREATE INDEX ai_job_idempotency_updated_at_idx
  ON public.ai_job_idempotency (updated_at);

CREATE TRIGGER ai_job_idempotency_updated_at
  BEFORE UPDATE ON public.ai_job_idempotency
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();