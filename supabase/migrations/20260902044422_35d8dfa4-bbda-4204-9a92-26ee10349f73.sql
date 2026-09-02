create or replace function public.has_electrical_read(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_entitlements e
    where e.user_id = _user_id
      and e.addon_key in ('electrical','electrical_fieldwrite','electrical_readonly')
      and e.status = 'active'
      and (e.expires_at is null or e.expires_at > now())
  )
$$;

create or replace function public.has_electrical_field_write(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_entitlements e
    where e.user_id = _user_id
      and e.addon_key in ('electrical','electrical_fieldwrite')
      and e.status = 'active'
      and (e.expires_at is null or e.expires_at > now())
  )
$$;

revoke all on function public.has_electrical_read(uuid) from anon;
revoke all on function public.has_electrical_field_write(uuid) from anon;
grant execute on function public.has_electrical_read(uuid) to authenticated, service_role;
grant execute on function public.has_electrical_field_write(uuid) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array[
    'electrical_branch_runs','electrical_breaker_positions','electrical_circuit_groups',
    'electrical_devices','electrical_feeders','electrical_field_observations',
    'electrical_intertie_configurations','electrical_interties','electrical_junction_boxes',
    'electrical_labels','electrical_loads','electrical_panel_exits','electrical_panels',
    'electrical_power_assets','electrical_raceway_waypoints','electrical_raceways',
    'electrical_racks','electrical_service_configurations','electrical_service_panels',
    'electrical_services'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_shared_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_electrical_read(auth.uid()))', t || '_shared_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_shared_field_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_electrical_field_write(auth.uid())) with check (public.has_electrical_field_write(auth.uid()))', t || '_shared_field_update', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;