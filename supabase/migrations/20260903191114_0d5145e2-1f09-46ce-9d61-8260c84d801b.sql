CREATE TABLE public.electrical_api_principals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_sha256 text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY['electrical:read','electrical:sor:read','electrical:documents:read']::text[],
  note text,
  disabled_at timestamptz,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.electrical_api_principals IS 'Scoped service principals for the read-only FarmOps Electrical API. Only the SHA-256 of a key is stored; the key itself is shown once at creation.';

CREATE INDEX electrical_api_principals_user_idx ON public.electrical_api_principals (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_api_principals TO authenticated;
GRANT ALL ON public.electrical_api_principals TO service_role;

ALTER TABLE public.electrical_api_principals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their own API principals"
  ON public.electrical_api_principals FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_electrical_api_principals_updated_at
  BEFORE UPDATE ON public.electrical_api_principals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();