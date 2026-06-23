CREATE TABLE public.vault_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('personal','shared')),
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  title TEXT NOT NULL,
  value_ciphertext TEXT NOT NULL,
  value_iv TEXT NOT NULL,
  value_tag TEXT NOT NULL,
  notes_ciphertext TEXT,
  notes_iv TEXT,
  notes_tag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vault_personal_has_owner CHECK (
    (scope = 'personal' AND owner_user_id IS NOT NULL) OR
    (scope = 'shared'   AND owner_user_id IS NULL)
  )
);

CREATE INDEX vault_secrets_scope_idx ON public.vault_secrets (scope);
CREATE INDEX vault_secrets_owner_idx ON public.vault_secrets (owner_user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_secrets TO authenticated;
GRANT ALL ON public.vault_secrets TO service_role;

ALTER TABLE public.vault_secrets ENABLE ROW LEVEL SECURITY;

-- Personal: only owner
CREATE POLICY "vault personal select own"
  ON public.vault_secrets FOR SELECT TO authenticated
  USING (scope = 'personal' AND owner_user_id = auth.uid());

CREATE POLICY "vault personal insert own"
  ON public.vault_secrets FOR INSERT TO authenticated
  WITH CHECK (scope = 'personal' AND owner_user_id = auth.uid() AND created_by = auth.uid());

CREATE POLICY "vault personal update own"
  ON public.vault_secrets FOR UPDATE TO authenticated
  USING (scope = 'personal' AND owner_user_id = auth.uid())
  WITH CHECK (scope = 'personal' AND owner_user_id = auth.uid());

CREATE POLICY "vault personal delete own"
  ON public.vault_secrets FOR DELETE TO authenticated
  USING (scope = 'personal' AND owner_user_id = auth.uid());

-- Shared: any signed-in user can read; only editor/admin can write
CREATE POLICY "vault shared select any auth"
  ON public.vault_secrets FOR SELECT TO authenticated
  USING (scope = 'shared');

CREATE POLICY "vault shared insert editor"
  ON public.vault_secrets FOR INSERT TO authenticated
  WITH CHECK (scope = 'shared' AND public.can_write(auth.uid()) AND created_by = auth.uid());

CREATE POLICY "vault shared update editor"
  ON public.vault_secrets FOR UPDATE TO authenticated
  USING (scope = 'shared' AND public.can_write(auth.uid()))
  WITH CHECK (scope = 'shared' AND public.can_write(auth.uid()));

CREATE POLICY "vault shared delete editor"
  ON public.vault_secrets FOR DELETE TO authenticated
  USING (scope = 'shared' AND public.can_write(auth.uid()));

CREATE TRIGGER vault_secrets_set_updated_at
  BEFORE UPDATE ON public.vault_secrets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();