-- Bitwarden mirror bookkeeping for the secrets vault.
-- No plaintext secret values and no Bitwarden credentials are stored here.

CREATE TABLE public.vault_bitwarden_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id uuid NOT NULL UNIQUE,
  mirror_personal boolean NOT NULL DEFAULT true,
  mirror_shared boolean NOT NULL DEFAULT false,
  folder_name text NOT NULL DEFAULT 'FarmOps',
  bw_folder_id text,
  paused boolean NOT NULL DEFAULT false,
  paused_reason text,
  bridge_token_hash text,
  bridge_token_fingerprint text,
  bridge_token_rotated_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_bitwarden_config TO authenticated;
GRANT ALL ON public.vault_bitwarden_config TO service_role;
ALTER TABLE public.vault_bitwarden_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vault_bw_config_admin_select" ON public.vault_bitwarden_config
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "vault_bw_config_admin_insert" ON public.vault_bitwarden_config
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "vault_bw_config_admin_update" ON public.vault_bitwarden_config
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (owner_user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "vault_bw_config_admin_delete" ON public.vault_bitwarden_config
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE public.vault_bitwarden_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  vault_secret_id uuid REFERENCES public.vault_secrets(id) ON DELETE SET NULL,
  bw_item_id text,
  bw_folder_id text,
  scope text NOT NULL DEFAULT 'personal',
  title text,
  last_pushed_fingerprint text,
  last_pulled_fingerprint text,
  last_bw_revision text,
  last_synced_at timestamptz,
  status text NOT NULL DEFAULT 'push_pending',
  conflict_detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vault_bw_links_scope_check CHECK (scope IN ('personal', 'shared')),
  CONSTRAINT vault_bw_links_status_check CHECK (
    status IN ('in_sync', 'conflict', 'push_pending', 'pull_pending', 'unreadable', 'orphan', 'deleted_remote', 'deleted_local')
  )
);

CREATE UNIQUE INDEX vault_bw_links_secret_idx
  ON public.vault_bitwarden_links (owner_user_id, vault_secret_id)
  WHERE vault_secret_id IS NOT NULL;
CREATE UNIQUE INDEX vault_bw_links_item_idx
  ON public.vault_bitwarden_links (owner_user_id, bw_item_id)
  WHERE bw_item_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_bitwarden_links TO authenticated;
GRANT ALL ON public.vault_bitwarden_links TO service_role;
ALTER TABLE public.vault_bitwarden_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vault_bw_links_admin_select" ON public.vault_bitwarden_links
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "vault_bw_links_admin_insert" ON public.vault_bitwarden_links
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "vault_bw_links_admin_update" ON public.vault_bitwarden_links
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (owner_user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "vault_bw_links_admin_delete" ON public.vault_bitwarden_links
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE public.vault_bitwarden_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  pushed_count integer NOT NULL DEFAULT 0,
  pulled_count integer NOT NULL DEFAULT 0,
  conflict_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vault_bw_runs_status_check CHECK (status IN ('running', 'ok', 'partial', 'failed'))
);

GRANT SELECT ON public.vault_bitwarden_runs TO authenticated;
GRANT ALL ON public.vault_bitwarden_runs TO service_role;
ALTER TABLE public.vault_bitwarden_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vault_bw_runs_admin_select" ON public.vault_bitwarden_runs
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER vault_bw_config_updated_at BEFORE UPDATE ON public.vault_bitwarden_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER vault_bw_links_updated_at BEFORE UPDATE ON public.vault_bitwarden_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER vault_bw_runs_updated_at BEFORE UPDATE ON public.vault_bitwarden_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();