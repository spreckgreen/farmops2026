create schema if not exists private;

create table if not exists private.electrical_peer_sync_cron_secrets (
  id uuid primary key default gen_random_uuid(),
  secret text not null unique,
  fingerprint text not null,
  status text not null default 'active' check (status in ('active','retiring','revoked')),
  created_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz not null default now(),
  retire_after timestamptz,
  revoked_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

alter table private.electrical_peer_sync_cron_secrets enable row level security;
revoke all on private.electrical_peer_sync_cron_secrets from anon, authenticated;

create unique index if not exists electrical_peer_sync_cron_secrets_one_active
  on private.electrical_peer_sync_cron_secrets (status) where status = 'active';

-- Seed the currently configured cron secret so the scheduled job keeps working
-- across this change; rotation replaces it afterwards.
insert into private.electrical_peer_sync_cron_secrets (secret, fingerprint, status, note)
select '8bb192c7c0026700a1b0b27f282ece5b6d57b698377ecc8c',
       substr(encode(sha256(convert_to('8bb192c7c0026700a1b0b27f282ece5b6d57b698377ecc8c','utf8')),'hex'),1,12),
       'active',
       'seeded from existing scheduled job configuration'
where not exists (select 1 from private.electrical_peer_sync_cron_secrets where status = 'active');

-- Verification for the cron endpoint (service role only).
create or replace function public.verify_peer_sync_cron_secret(_secret text)
returns boolean
language sql
stable
security definer
set search_path = private, public, extensions
as $$
  select exists (
    select 1 from private.electrical_peer_sync_cron_secrets s
    where s.secret = _secret
      and (s.status = 'active'
        or (s.status = 'retiring' and s.retire_after is not null and s.retire_after > now()))
  );
$$;
revoke all on function public.verify_peer_sync_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_peer_sync_cron_secret(text) to service_role;

-- Admin-visible listing: never returns the plaintext secret.
create or replace function public.list_peer_sync_cron_secrets()
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
  if not private.has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'admin role required';
  end if;
  return query
    select s.id, s.fingerprint, s.status, s.activated_at, s.retire_after, s.revoked_at, s.note
    from private.electrical_peer_sync_cron_secrets s
    order by s.activated_at desc
    limit 20;
end;
$$;
grant execute on function public.list_peer_sync_cron_secrets() to authenticated, service_role;

-- Rotation: mint a new active secret, retire the previous one for a grace
-- window, and rewrite the scheduled job so it always sends the active secret.
create or replace function public.rotate_peer_sync_cron_secret(_grace_minutes integer default 15)
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
  if not private.has_role(auth.uid(), 'admin'::app_role) then
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
  values (v_secret, v_fp, 'active', auth.uid(), 'rotated by admin');

  return query select v_fp, v_old_fp, case when _grace_minutes = 0 then null::timestamptz else v_retire end;
end;
$$;
revoke all on function public.rotate_peer_sync_cron_secret(integer) from public, anon;
grant execute on function public.rotate_peer_sync_cron_secret(integer) to authenticated, service_role;

-- Immediate invalidation of every non-active secret.
create or replace function public.revoke_retiring_peer_sync_cron_secrets()
returns integer
language plpgsql
volatile
security definer
set search_path = private, public
as $$
declare v_count integer;
begin
  if not private.has_role(auth.uid(), 'admin'::app_role) then
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
revoke all on function public.revoke_retiring_peer_sync_cron_secrets() from public, anon;
grant execute on function public.revoke_retiring_peer_sync_cron_secrets() to authenticated, service_role;

-- The scheduled job now reads the active secret at call time, so rotation needs
-- no schedule edit and no redeploy.
-- pg_cron is optional: self-hosted deployments may schedule the peer sync
-- outside the database. Only rewrite the job when it actually exists.
do $do$
declare v_jobid bigint;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'pg_cron not installed — skipping peer-sync schedule rewrite';
    return;
  end if;
  execute $q$select jobid from cron.job where jobname = 'electrical-peer-audit-sync'$q$ into v_jobid;
  if v_jobid is null then
    raise notice 'electrical-peer-audit-sync job not scheduled — skipping rewrite';
    return;
  end if;
  perform cron.alter_job(
    v_jobid,
    command := $job$
  select net.http_post(
    url:='https://project--3262d5a9-40fd-4cf4-a353-9549a732cb96.lovable.app/api/public/hooks/electrical-peer-sync',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-electrical-peer-sync-secret',
      (select s.secret from private.electrical_peer_sync_cron_secrets s
        where s.status = 'active' order by s.activated_at desc limit 1)
    ),
    body:='{}'::jsonb
  ) as request_id;
  $job$
  );
end
$do$;
