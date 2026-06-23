
CREATE TABLE public.procedures (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.procedures TO authenticated;
GRANT ALL ON public.procedures TO service_role;

ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own procedures"
ON public.procedures FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER procedures_set_updated_at
BEFORE UPDATE ON public.procedures
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX procedures_user_idx ON public.procedures(user_id, name);
