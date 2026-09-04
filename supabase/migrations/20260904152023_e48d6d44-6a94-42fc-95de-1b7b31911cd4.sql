-- These credential actions are invoked only by admin-verified server code using
-- the service role, so signed-in users must not be able to call them directly.
revoke execute on function public.list_peer_sync_cron_secrets() from authenticated;
revoke execute on function public.rotate_peer_sync_cron_secret(integer) from authenticated;
revoke execute on function public.revoke_retiring_peer_sync_cron_secrets() from authenticated;

-- Callers pass the acting administrator explicitly since there is no signed-in
-- session inside a service-role call.
create or replace function public.list_peer_sync_cron_secrets(_actor uuid)
returns table (
  id uuid,
  fingerprint text,
  status text,
  activated_at timestamptz,
  retire_after timestamptz,
  revoked_at timestamptz,
  note text
)
language plpgsql
stable
security definer
set search_path = private, public
as $$
begin
  if not private.has_role(_actor, 'admin'::app_role) then
    raise exception 'admin role required';
  end if;
  return query
    select s.id, s.fingerprint, s.status, s.activated_at, s.retire_after, s.revoked_at, s.note
    from private.electrical_peer_sync_cron_secrets s
    order by s.activated_at desc
    limit 20;
end;
$$;
revoke all on function public.list_peer_sync_cron_secrets(uuid) from public, anon, authenticated;
grant execute on function public.list_peer_sync_cron_secrets(uuid) to service_role;

create or replace function public.rotate_peer_sync_cron_secret(_actor uuid, _grace_minutes integer default 15)
returns table (fingerprint text, retired_fingerprint text, retire_after timestamptz)
language plpgsql
volatile
security definer
set search_path = private, public, extensions
as $$
declare
  v_secret text;
  v_fp text;
  v_old_fp text;
  v_retire timestamptz;
begin
  if not private.has_role(_actor, 'admin'::app_role) then
    raise exception 'admin role required';
  end if;
  if _grace_minutes < 0 or _grace_minutes > 1440 then
    raise exception 'grace window must be between 0 and 1440 minutes';
  end if;

  v_retire := now() + make_interval(mins => _grace_minutes);

  update private.electrical_peer_sync_cron_secrets s
     set status = case when _grace_minutes = 0 then 'revoked' else 'retiring' end,
         retire_after = case when _grace_minutes = 0 then null else v_retire end,
         revoked_at = case when _grace_minutes = 0 then now() else null end
   where s.status = 'active'
  returning s.fingerprint into v_old_fp;

  v_secret := encode(gen_random_bytes(24), 'hex');
  v_fp := substr(encode(digest(v_secret, 'sha256'), 'hex'), 1, 12);

  insert into private.electrical_peer_sync_cron_secrets (secret, fingerprint, status, created_by, note)
  values (v_secret, v_fp, 'active', _actor, 'rotated by admin');

  return query select v_fp, v_old_fp, case when _grace_minutes = 0 then null::timestamptz else v_retire end;
end;
$$;
revoke all on function public.rotate_peer_sync_cron_secret(uuid, integer) from public, anon, authenticated;
grant execute on function public.rotate_peer_sync_cron_secret(uuid, integer) to service_role;

create or replace function public.revoke_retiring_peer_sync_cron_secrets(_actor uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = private, public
as $$
declare v_count integer;
begin
  if not private.has_role(_actor, 'admin'::app_role) then
    raise exception 'admin role required';
  end if;
  with upd as (
    update private.electrical_peer_sync_cron_secrets
       set status = 'revoked', revoked_at = now(), retire_after = null
     where status = 'retiring'
    returning 1
  )
  select count(*) into v_count from upd;
  return coalesce(v_count, 0);
end;
$$;
revoke all on function public.revoke_retiring_peer_sync_cron_secrets(uuid) from public, anon, authenticated;
grant execute on function public.revoke_retiring_peer_sync_cron_secrets(uuid) to service_role;

drop function if exists public.list_peer_sync_cron_secrets();
drop function if exists public.rotate_peer_sync_cron_secret(integer);
drop function if exists public.revoke_retiring_peer_sync_cron_secrets();