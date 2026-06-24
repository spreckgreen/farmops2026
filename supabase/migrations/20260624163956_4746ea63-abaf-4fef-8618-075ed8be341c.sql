-- 1. Create private schema (not exposed via Data API)
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- 2. Recreate helper functions in private schema
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE OR REPLACE FUNCTION private.can_write(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('editor','admin')) $$;

CREATE OR REPLACE FUNCTION private.is_approved(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND status = 'approved') $$;

-- 3. Lock down: revoke from PUBLIC, grant only to roles needed by RLS evaluation
REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_write(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_approved(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_write(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_approved(uuid) TO authenticated, service_role;

-- 4. Recreate every policy referencing the public.* helpers to use private.*

-- profiles
DROP POLICY "Admins read all profiles" ON public.profiles;
CREATE POLICY "Admins read all profiles" ON public.profiles FOR SELECT TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY "Admins update any profile" ON public.profiles;
CREATE POLICY "Admins update any profile" ON public.profiles FOR UPDATE TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- user_roles
DROP POLICY "Admins read all roles" ON public.user_roles;
CREATE POLICY "Admins read all roles" ON public.user_roles FOR SELECT TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY "Admins insert roles" ON public.user_roles;
CREATE POLICY "Admins insert roles" ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY "Admins update roles" ON public.user_roles;
CREATE POLICY "Admins update roles" ON public.user_roles FOR UPDATE TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY "Admins delete roles" ON public.user_roles;
CREATE POLICY "Admins delete roles" ON public.user_roles FOR DELETE TO authenticated
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

-- activity_log
DROP POLICY activity_log_owner_insert ON public.activity_log;
CREATE POLICY activity_log_owner_insert ON public.activity_log FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY "Owners can delete their activity log entries" ON public.activity_log;
CREATE POLICY "Owners can delete their activity log entries" ON public.activity_log FOR DELETE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY "Owners can update their activity log entries" ON public.activity_log;
CREATE POLICY "Owners can update their activity log entries" ON public.activity_log FOR UPDATE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()))
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));

-- consumables
DROP POLICY "Users insert own consumables" ON public.consumables;
CREATE POLICY "Users insert own consumables" ON public.consumables FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY "Users update own consumables" ON public.consumables;
CREATE POLICY "Users update own consumables" ON public.consumables FOR UPDATE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()))
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY "Users delete own consumables" ON public.consumables;
CREATE POLICY "Users delete own consumables" ON public.consumables FOR DELETE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()));

-- daily_notes
DROP POLICY daily_notes_owner_insert ON public.daily_notes;
CREATE POLICY daily_notes_owner_insert ON public.daily_notes FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY daily_notes_owner_update ON public.daily_notes;
CREATE POLICY daily_notes_owner_update ON public.daily_notes FOR UPDATE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()))
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY daily_notes_owner_delete ON public.daily_notes;
CREATE POLICY daily_notes_owner_delete ON public.daily_notes FOR DELETE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()));

-- inventory_items
DROP POLICY "Users insert own inventory" ON public.inventory_items;
CREATE POLICY "Users insert own inventory" ON public.inventory_items FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY "Users update own inventory" ON public.inventory_items;
CREATE POLICY "Users update own inventory" ON public.inventory_items FOR UPDATE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()))
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY "Users delete own inventory" ON public.inventory_items;
CREATE POLICY "Users delete own inventory" ON public.inventory_items FOR DELETE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()));

-- maintenance_records
DROP POLICY maintenance_owner_insert ON public.maintenance_records;
CREATE POLICY maintenance_owner_insert ON public.maintenance_records FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY maintenance_owner_update ON public.maintenance_records;
CREATE POLICY maintenance_owner_update ON public.maintenance_records FOR UPDATE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()))
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY maintenance_owner_delete ON public.maintenance_records;
CREATE POLICY maintenance_owner_delete ON public.maintenance_records FOR DELETE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()));

-- projects
DROP POLICY projects_owner_insert ON public.projects;
CREATE POLICY projects_owner_insert ON public.projects FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY projects_owner_update ON public.projects;
CREATE POLICY projects_owner_update ON public.projects FOR UPDATE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()))
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY projects_owner_delete ON public.projects;
CREATE POLICY projects_owner_delete ON public.projects FOR DELETE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()));

-- summaries
DROP POLICY summaries_owner_insert ON public.summaries;
CREATE POLICY summaries_owner_insert ON public.summaries FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY summaries_owner_update ON public.summaries;
CREATE POLICY summaries_owner_update ON public.summaries FOR UPDATE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()))
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY summaries_owner_delete ON public.summaries;
CREATE POLICY summaries_owner_delete ON public.summaries FOR DELETE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()));

-- tasks
DROP POLICY tasks_owner_insert ON public.tasks;
CREATE POLICY tasks_owner_insert ON public.tasks FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY tasks_owner_update ON public.tasks;
CREATE POLICY tasks_owner_update ON public.tasks FOR UPDATE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()))
WITH CHECK (auth.uid() = user_id AND private.can_write(auth.uid()));
DROP POLICY tasks_owner_delete ON public.tasks;
CREATE POLICY tasks_owner_delete ON public.tasks FOR DELETE TO authenticated
USING (auth.uid() = user_id AND private.can_write(auth.uid()));

-- vault_secrets (personal)
DROP POLICY "vault personal select own" ON public.vault_secrets;
CREATE POLICY "vault personal select own" ON public.vault_secrets FOR SELECT TO authenticated
USING (scope = 'personal' AND owner_user_id = auth.uid() AND private.is_approved(auth.uid()));
DROP POLICY "vault personal insert own" ON public.vault_secrets;
CREATE POLICY "vault personal insert own" ON public.vault_secrets FOR INSERT TO authenticated
WITH CHECK (scope = 'personal' AND owner_user_id = auth.uid() AND created_by = auth.uid() AND private.is_approved(auth.uid()));
DROP POLICY "vault personal update own" ON public.vault_secrets;
CREATE POLICY "vault personal update own" ON public.vault_secrets FOR UPDATE TO authenticated
USING (scope = 'personal' AND owner_user_id = auth.uid() AND private.is_approved(auth.uid()))
WITH CHECK (scope = 'personal' AND owner_user_id = auth.uid() AND private.is_approved(auth.uid()));
DROP POLICY "vault personal delete own" ON public.vault_secrets;
CREATE POLICY "vault personal delete own" ON public.vault_secrets FOR DELETE TO authenticated
USING (scope = 'personal' AND owner_user_id = auth.uid() AND private.is_approved(auth.uid()));

-- vault_secrets (shared)
DROP POLICY "vault shared select approved" ON public.vault_secrets;
CREATE POLICY "vault shared select approved" ON public.vault_secrets FOR SELECT TO authenticated
USING (scope = 'shared' AND private.is_approved(auth.uid()));
DROP POLICY "vault shared insert editor" ON public.vault_secrets;
CREATE POLICY "vault shared insert editor" ON public.vault_secrets FOR INSERT TO authenticated
WITH CHECK (scope = 'shared' AND private.is_approved(auth.uid()) AND private.can_write(auth.uid()) AND created_by = auth.uid());
DROP POLICY "vault shared update editor" ON public.vault_secrets;
CREATE POLICY "vault shared update editor" ON public.vault_secrets FOR UPDATE TO authenticated
USING (scope = 'shared' AND private.is_approved(auth.uid()) AND private.can_write(auth.uid()))
WITH CHECK (scope = 'shared' AND private.is_approved(auth.uid()) AND private.can_write(auth.uid()));
DROP POLICY "vault shared delete editor" ON public.vault_secrets;
CREATE POLICY "vault shared delete editor" ON public.vault_secrets FOR DELETE TO authenticated
USING (scope = 'shared' AND private.is_approved(auth.uid()) AND private.can_write(auth.uid()));

-- 5. Drop the now-unused public copies
DROP FUNCTION public.has_role(uuid, public.app_role);
DROP FUNCTION public.can_write(uuid);
DROP FUNCTION public.is_approved(uuid);