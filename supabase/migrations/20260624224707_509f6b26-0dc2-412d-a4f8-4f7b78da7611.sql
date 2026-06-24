
-- 1) Enrolled YubiKey credentials
CREATE TABLE public.vault_key_wrap_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id bytea NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0,
  salt bytea NOT NULL,
  transports text[] NOT NULL DEFAULT '{}',
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_key_wrap_credentials TO authenticated;
GRANT ALL ON public.vault_key_wrap_credentials TO service_role;
ALTER TABLE public.vault_key_wrap_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read own wrap credentials"
  ON public.vault_key_wrap_credentials FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "admins insert own wrap credentials"
  ON public.vault_key_wrap_credentials FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "admins update own wrap credentials"
  ON public.vault_key_wrap_credentials FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "admins delete own wrap credentials"
  ON public.vault_key_wrap_credentials FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));

-- 2) Export audit log
CREATE TABLE public.vault_key_export_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id bytea,
  action text NOT NULL CHECK (action IN ('enroll','enroll_failed','delete','export_started','export_completed','export_failed')),
  user_agent text,
  ip text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.vault_key_export_audit TO authenticated;
GRANT ALL ON public.vault_key_export_audit TO service_role;
ALTER TABLE public.vault_key_export_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read own export audit"
  ON public.vault_key_export_audit FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "admins insert own export audit"
  ON public.vault_key_export_audit FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));

-- 3) WebAuthn challenges (short-lived)
CREATE TABLE public.webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('enroll','export')),
  challenge bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.webauthn_challenges TO authenticated;
GRANT ALL ON public.webauthn_challenges TO service_role;
ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage own challenges"
  ON public.webauthn_challenges FOR ALL TO authenticated
  USING (user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX idx_vault_key_wrap_credentials_user ON public.vault_key_wrap_credentials(user_id);
CREATE INDEX idx_vault_key_export_audit_user ON public.vault_key_export_audit(user_id, created_at DESC);
CREATE INDEX idx_webauthn_challenges_user ON public.webauthn_challenges(user_id, purpose);
