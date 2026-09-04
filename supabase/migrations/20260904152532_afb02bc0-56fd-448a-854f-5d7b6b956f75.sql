-- Execution log for the scheduled, preview-only peer audit-batch pull.
create table if not exists public.electrical_peer_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  trigger text not null default 'scheduled',
  outcome text not null,
  skipped_reason text,
  peer_origin text,
  peer_batches_seen integer not null default 0,
  candidates integer not null default 0,
  staged integer not null default 0,
  failed integer not null default 0,
  capped boolean not null default false,
  error text,
  items jsonb,
  created_at timestamptz not null default now(),
  constraint electrical_peer_sync_runs_outcome_check
    check (outcome in ('success','partial','failed','skipped')),
  constraint electrical_peer_sync_runs_trigger_check
    check (trigger in ('scheduled','manual'))
);

create index if not exists electrical_peer_sync_runs_started_at_idx
  on public.electrical_peer_sync_runs (started_at desc);

grant select on public.electrical_peer_sync_runs to authenticated;
grant all on public.electrical_peer_sync_runs to service_role;

alter table public.electrical_peer_sync_runs enable row level security;

drop policy if exists "peer sync runs admin read" on public.electrical_peer_sync_runs;
create policy "peer sync runs admin read"
on public.electrical_peer_sync_runs
for select
to authenticated
using (private.has_role(auth.uid(), 'admin'::app_role));