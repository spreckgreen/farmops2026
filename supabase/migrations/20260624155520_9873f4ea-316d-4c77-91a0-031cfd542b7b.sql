
-- Helper: is the given user approved?
CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND status = 'approved'
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_approved(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_approved(uuid) TO authenticated, service_role;

-- Rebuild vault_secrets policies to require approved profile
DROP POLICY IF EXISTS "vault personal select own" ON public.vault_secrets;
DROP POLICY IF EXISTS "vault personal insert own" ON public.vault_secrets;
DROP POLICY IF EXISTS "vault personal update own" ON public.vault_secrets;
DROP POLICY IF EXISTS "vault personal delete own" ON public.vault_secrets;
DROP POLICY IF EXISTS "vault shared select any auth" ON public.vault_secrets;
DROP POLICY IF EXISTS "vault shared insert editor" ON public.vault_secrets;
DROP POLICY IF EXISTS "vault shared update editor" ON public.vault_secrets;
DROP POLICY IF EXISTS "vault shared delete editor" ON public.vault_secrets;

CREATE POLICY "vault personal select own"
  ON public.vault_secrets FOR SELECT TO authenticated
  USING (scope = 'personal' AND owner_user_id = auth.uid() AND public.is_approved(auth.uid()));

CREATE POLICY "vault personal insert own"
  ON public.vault_secrets FOR INSERT TO authenticated
  WITH CHECK (scope = 'personal' AND owner_user_id = auth.uid() AND created_by = auth.uid() AND public.is_approved(auth.uid()));

CREATE POLICY "vault personal update own"
  ON public.vault_secrets FOR UPDATE TO authenticated
  USING (scope = 'personal' AND owner_user_id = auth.uid() AND public.is_approved(auth.uid()))
  WITH CHECK (scope = 'personal' AND owner_user_id = auth.uid() AND public.is_approved(auth.uid()));

CREATE POLICY "vault personal delete own"
  ON public.vault_secrets FOR DELETE TO authenticated
  USING (scope = 'personal' AND owner_user_id = auth.uid() AND public.is_approved(auth.uid()));

CREATE POLICY "vault shared select approved"
  ON public.vault_secrets FOR SELECT TO authenticated
  USING (scope = 'shared' AND public.is_approved(auth.uid()));

CREATE POLICY "vault shared insert editor"
  ON public.vault_secrets FOR INSERT TO authenticated
  WITH CHECK (scope = 'shared' AND public.is_approved(auth.uid()) AND public.can_write(auth.uid()) AND created_by = auth.uid());

CREATE POLICY "vault shared update editor"
  ON public.vault_secrets FOR UPDATE TO authenticated
  USING (scope = 'shared' AND public.is_approved(auth.uid()) AND public.can_write(auth.uid()))
  WITH CHECK (scope = 'shared' AND public.is_approved(auth.uid()) AND public.can_write(auth.uid()));

CREATE POLICY "vault shared delete editor"
  ON public.vault_secrets FOR DELETE TO authenticated
  USING (scope = 'shared' AND public.is_approved(auth.uid()) AND public.can_write(auth.uid()));
