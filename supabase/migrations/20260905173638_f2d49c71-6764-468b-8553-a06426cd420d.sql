CREATE TABLE public.vault_key_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  key_shape text NOT NULL,
  event text NOT NULL,
  note text,
  rows_total integer,
  rows_readable integer,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vault_key_journal_event_check CHECK (event IN ('observed','key_changed','change_acknowledged','change_started','change_completed'))
);

CREATE INDEX vault_key_journal_created_at_idx ON public.vault_key_journal (created_at DESC);

GRANT SELECT, INSERT ON public.vault_key_journal TO authenticated;
GRANT ALL ON public.vault_key_journal TO service_role;

ALTER TABLE public.vault_key_journal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read vault key journal"
ON public.vault_key_journal FOR SELECT TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can append vault key journal"
ON public.vault_key_journal FOR INSERT TO authenticated
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role) AND recorded_by = auth.uid());