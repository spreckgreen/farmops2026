# Rachio irrigation integration

Read-only dashboard + watering log + webhook-driven activity, authenticated
with a single household Rachio Personal API token stored in the Vault, with
zones optionally linkable to garden plots and orchard trees.

## What you'll see in the app

- **New `/irrigation` route** (under `_authenticated`) with three panes:
  1. **Controllers & zones** — controller name/status, per-zone card
     (name, area, nozzle, link to plot/tree), last run, next scheduled run.
  2. **Recent watering** — table of runs (zone, start, duration, gallons,
     source: scheduled/manual/skipped), filterable by date and zone.
  3. **Setup** — "Connect Rachio" panel: paste Personal API token (stored
     server-side via Vault), test connection, copy webhook URL to register
     in Rachio's app.
- **Zone linking UI** — on each zone card, a "Link to…" picker writes
  `garden_plot_id` / `orchard_tree_id` onto `rachio_zones`. Garden plot
  and orchard tree detail pages get an "Irrigation" section showing the
  linked zone's last/next run and last 30 days of gallons.
- **Activity log** — each completed Rachio run produces an
  `activity_log` row (`type: 'irrigation'`, summary "Zone X watered for
  Y min / Z gal"), so it appears in the daily note feed automatically.

## Auth model

Single Rachio Personal API token per household, kept in the existing
**shared Vault** under a reserved title (`rachio.personal_api_token`).
The token is fetched server-side at call time via the existing
`vault.functions.ts` reveal path — never shipped to the browser. Setup UI
writes it through `createVaultItem`; sync code reads it through a new
`getRachioToken()` server-only helper that calls the same decryption path.

## Data model (new tables, all RLS-protected)

```text
rachio_controllers   id, household_id, rachio_id (unique), name, model,
                     serial_number, status, last_synced_at, raw jsonb
rachio_zones         id, household_id, controller_id (fk), rachio_id (unique),
                     zone_number, name, enabled, nozzle, area_sqft,
                     garden_plot_id (fk, nullable), orchard_tree_id (fk, nullable),
                     last_run_at, next_run_at, raw jsonb
rachio_runs          id, household_id, zone_id (fk), rachio_event_id (unique),
                     started_at, ended_at, duration_seconds, gallons,
                     source (scheduled|manual|api|skipped),
                     status (completed|skipped|aborted), raw jsonb
rachio_webhook_events id, received_at, signature_ok bool, event_type,
                     payload jsonb, processed_at, error  -- audit trail
```

All four tables: GRANT to authenticated + service_role, RLS scoped via
the existing household membership helper (same pattern as `vault_secrets`
shared scope). `service_role` is what the webhook handler uses.

## Server functions (`src/lib/rachio.functions.ts`)

- `getRachioConnectionStatus()` — returns `{ connected, lastSyncAt,
  controllerCount }` for the Setup pane.
- `saveRachioToken({ token })` — validates token with a `GET /1/public/person/info`
  call, then upserts the shared vault entry.
- `syncRachioInventory()` — pulls person → devices → zones, upserts
  controllers/zones, preserves existing plot/tree links by `rachio_id`.
- `syncRachioRecentRuns({ days = 7 })` — pulls
  `/1/public/device/{id}/event` for each controller, upserts into
  `rachio_runs`, mirrors completed ones into `activity_log`. Used by the
  manual "Sync now" button and a daily cron as a webhook safety net.
- `linkRachioZone({ zoneId, gardenPlotId?, orchardTreeId? })` —
  updates the zone's link columns.
- `listRachioDashboard({ days })` — single read used by `/irrigation`
  loader (controllers, zones with links resolved, runs window).

All use `requireSupabaseAuth`. Rachio HTTP calls go through a small
`rachio-client.server.ts` helper that reads the token once per request.

## Webhook endpoint (Rachio → Bostead)

- New file `src/routes/api/public/webhooks/rachio.ts` (TanStack server
  route under `/api/public/*` so published auth doesn't block it).
- Validates Rachio's `X-Rachio-Signature` HMAC against a new
  `RACHIO_WEBHOOK_SECRET` (random 32-byte; created via
  `generate_secret`).
- Inserts into `rachio_webhook_events` (audit), then for
  `DEVICE_ZONE_RUN_COMPLETED` / `_STARTED` / `_SKIPPED` upserts
  `rachio_runs` and writes/updates the matching `activity_log` row.
- Returns 200 fast; defers any heavy enrichment to the daily sync job.
- Setup pane displays the public webhook URL
  (`https://bostead.lovable.app/api/public/webhooks/rachio`) plus the
  webhook secret for the user to paste into Rachio's webhook config.

## Background sync

- Reuse the existing pg_cron pattern (see `schedule-jobs-modern`) to call
  `/api/public/hooks/rachio-sync` once daily, which invokes
  `syncRachioInventory` + `syncRachioRecentRuns({ days: 2 })` server-side
  as a backstop in case a webhook was missed.

## Files touched / created

- New: `src/lib/rachio.functions.ts`, `src/lib/rachio-client.server.ts`,
  `src/routes/_authenticated/irrigation.tsx`,
  `src/routes/api/public/webhooks/rachio.ts`,
  `src/routes/api/public/hooks/rachio-sync.ts`,
  `src/components/irrigation/` (ControllerCard, ZoneCard, RunsTable,
  SetupPanel, LinkZoneDialog).
- Modified: `src/components/app-layout.tsx` (nav entry "Irrigation"),
  `src/routes/food.garden.tsx` + `src/routes/food.orchard.tsx` (small
  "Irrigation" sub-panel showing the linked zone summary).
- Migrations: four new tables above + RLS/grants + indexes
  (`rachio_runs(zone_id, started_at desc)`,
  `rachio_zones(garden_plot_id)`, `rachio_zones(orchard_tree_id)`).
- Secret: `RACHIO_WEBHOOK_SECRET` (auto-generated). No third-party API
  key requested up-front — the user pastes their Rachio Personal API
  token into the in-app Setup panel.

## What I'll need from you after build

1. A **Rachio Personal API token** (Rachio app → Account Settings → Get
   API Key) — paste into the in-app Setup panel; it lands in the shared
   Vault, not in env.
2. **Register the webhook** in Rachio (app or `POST /1/public/notification/webhook`)
   pointing at the URL shown in Setup, using the secret shown next to it.
3. Optional: link each zone to the plot/tree it actually waters.

After that, the dashboard, watering log, and daily-note activity entries
populate automatically; the daily cron acts as a safety net for missed
webhooks.
