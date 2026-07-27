ALTER TABLE public.vault_secrets ADD COLUMN IF NOT EXISTS key_version smallint NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS vault_secrets_key_version_idx ON public.vault_secrets (key_version);