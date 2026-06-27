ALTER TABLE public.vault_secrets ADD COLUMN IF NOT EXISTS env_key text;
CREATE UNIQUE INDEX IF NOT EXISTS vault_secrets_env_key_unique
  ON public.vault_secrets (env_key)
  WHERE env_key IS NOT NULL AND scope = 'shared';