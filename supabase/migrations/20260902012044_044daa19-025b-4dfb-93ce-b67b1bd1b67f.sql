ALTER TABLE public.app_entitlements
  ADD COLUMN IF NOT EXISTS revoked_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked_until timestamptz;