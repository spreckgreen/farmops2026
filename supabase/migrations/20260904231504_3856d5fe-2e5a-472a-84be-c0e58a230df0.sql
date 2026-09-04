-- 1. No anonymous execution of internal permission helpers.
revoke execute on all functions in schema private from anon;
revoke execute on all functions in schema private from public;
revoke execute on function private.can_write(uuid) from anon, public;
revoke execute on function private.has_role(uuid, public.app_role) from anon, public;
revoke execute on function private.is_approved(uuid) from anon, public;
grant execute on function private.can_write(uuid) to authenticated, service_role;
grant execute on function private.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function private.is_approved(uuid) to authenticated, service_role;
grant execute on function private.has_electrical_read(uuid) to authenticated, service_role;
grant execute on function private.has_electrical_field_write(uuid) to authenticated, service_role;

-- 2. Database-level allowlist of recognised AND currently activated API scopes.
--    Phase 2/3 write scopes are deliberately absent: they are defined but not
--    activated, so no key may be stored carrying them.
create or replace function public.electrical_api_activated_scopes()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'electrical:read',
    'electrical:sor:read',
    'electrical:documents:read',
    'electrical:audit-batches:read'
  ]::text[]
$$;

revoke execute on function public.electrical_api_activated_scopes() from anon, public;
grant execute on function public.electrical_api_activated_scopes() to authenticated, service_role;

alter table public.electrical_api_principals
  drop constraint if exists electrical_api_principals_scopes_activated;
alter table public.electrical_api_principals
  add constraint electrical_api_principals_scopes_activated
  check (
    scopes is not null
    and cardinality(scopes) > 0
    and scopes <@ public.electrical_api_activated_scopes()
  );

-- 3. Owner entitlement is required for direct create/update/delete, not just ownership.
drop policy if exists "Owners manage their own API principals" on public.electrical_api_principals;

create policy "Owners with electrical read see their API principals"
  on public.electrical_api_principals for select to authenticated
  using (auth.uid() = user_id and private.has_electrical_read(auth.uid()));

create policy "Owners with electrical field write create API principals"
  on public.electrical_api_principals for insert to authenticated
  with check (auth.uid() = user_id and private.has_electrical_field_write(auth.uid()));

create policy "Owners with electrical field write update API principals"
  on public.electrical_api_principals for update to authenticated
  using (auth.uid() = user_id and private.has_electrical_field_write(auth.uid()))
  with check (auth.uid() = user_id and private.has_electrical_field_write(auth.uid()));

create policy "Owners with electrical field write delete API principals"
  on public.electrical_api_principals for delete to authenticated
  using (auth.uid() = user_id and private.has_electrical_field_write(auth.uid()));