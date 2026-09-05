-- Owners whose electrical records a user may see: themselves, plus the
-- administrator(s) who granted their active electrical entitlement.
create or replace function private.electrical_visible_owner_ids(_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct oid_), '{}'::uuid[])
  from (
    select _user_id as oid_
    where _user_id is not null
    union
    select e.granted_by
    from public.app_entitlements e
    where e.user_id = _user_id
      and e.granted_by is not null
      and e.addon_key in ('electrical','electrical_fieldwrite','electrical_readonly')
      and e.status = 'active'
      and (e.expires_at is null or e.expires_at > now())
      and (e.blocked_until is null or e.blocked_until <= now())
      and exists (
        select 1 from public.user_roles r
        where r.user_id = e.granted_by and r.role = 'admin'::app_role
      )
  ) s
$$;

revoke all on function private.electrical_visible_owner_ids(uuid) from public, anon;
grant execute on function private.electrical_visible_owner_ids(uuid) to authenticated, service_role;

-- Rebuild every shared electrical read/field-write policy so it is scoped to the
-- owners above instead of granting access to all owners' records.
do $do$
declare
  r record;
begin
  for r in
    select c.relname as tbl, p.polname as pol, p.polcmd as cmd
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and (p.polname like '%\_shared\_read' or p.polname like '%\_shared\_field\_update')
  loop
    execute format('drop policy %I on public.%I', r.pol, r.tbl);
    if r.cmd = 'r' then
      execute format(
        'create policy %I on public.%I for select to authenticated using (private.has_electrical_read(auth.uid()) and user_id = any(private.electrical_visible_owner_ids(auth.uid())))',
        r.pol, r.tbl);
    else
      execute format(
        'create policy %I on public.%I for update to authenticated using (private.has_electrical_field_write(auth.uid()) and user_id = any(private.electrical_visible_owner_ids(auth.uid()))) with check (private.has_electrical_field_write(auth.uid()) and user_id = any(private.electrical_visible_owner_ids(auth.uid())))',
        r.pol, r.tbl);
    end if;
  end loop;
end
$do$;