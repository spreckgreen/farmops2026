CREATE TABLE public.data_clean_backups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  scope_kind text NOT NULL,
  module_key text,
  site_plan_id uuid REFERENCES public.site_plans(id) ON DELETE SET NULL,
  site_name text,
  location_label text,
  label text NOT NULL,
  table_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_rows integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{"tables":[]}'::jsonb,
  integrity_digest text,
  withheld_notes text[] NOT NULL DEFAULT ARRAY[]::text[],
  cleared_at timestamp with time zone NOT NULL DEFAULT now(),
  restored_at timestamp with time zone,
  restored_by uuid,
  restore_report jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT data_clean_backups_scope_kind_check
    CHECK (scope_kind IN ('WHOLE_SITE', 'MODULE', 'LOCATION'))
);

GRANT SELECT, INSERT, UPDATE ON public.data_clean_backups TO authenticated;
GRANT ALL ON public.data_clean_backups TO service_role;

ALTER TABLE public.data_clean_backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read their own clear backups"
  ON public.data_clean_backups FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins create their own clear backups"
  ON public.data_clean_backups FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update their own clear backups"
  ON public.data_clean_backups FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX data_clean_backups_user_created_idx
  ON public.data_clean_backups (user_id, created_at DESC);

CREATE TRIGGER data_clean_backups_set_updated_at
  BEFORE UPDATE ON public.data_clean_backups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
