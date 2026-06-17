# Food Production tab

A new top-level `/food` section in the app nav that manages four related domains, each on its own sub-tab, all backed by per-user RLS and the existing TanStack Start + server-function pattern used elsewhere in the app.

## Navigation

- New entry "Food" in the main nav, between Inventory and Maintenance.
- Route layout: `/food` (overview + sub-tab nav) with children:
  - `/food/crops` — plantings & harvests
  - `/food/livestock` — animals & events
  - `/food/processing` — processing batches (canning, butchering, dairy, etc.)
  - `/food/storage` — food storage inventory (pantry / freezer / cellar)
- All routes live under `_authenticated/` so they inherit the existing auth gate.

## Data model (new tables, all RLS-on, scoped to `auth.uid()`)

```text
crop_plantings        crop, variety, area/bed, planted_on, expected_harvest, status, notes
crop_harvests         planting_id, harvested_on, quantity, unit, quality, notes
livestock_animals     species, breed, tag/name, sex, born_on, status, notes
livestock_events      animal_id, event_type (weight|feed|birth|treatment|sale|cull),
                      occurred_on, value (numeric), unit, notes
processing_batches    batch_type (canning|butchering|dairy|baking|other),
                      product, started_on, finished_on, yield_qty, yield_unit, status, notes
processing_inputs     batch_id, source_kind (crop_harvest|livestock_animal|food_storage|consumable|free_text),
                      source_id (nullable), label, quantity, unit
food_storage_items    name, category (produce|meat|dairy|grain|preserved|other),
                      location (pantry|fridge|freezer|cellar|other),
                      quantity, unit, packaged_on, best_by, source_batch_id (nullable), notes
food_storage_moves    item_id, direction (in|out|adjust), quantity, occurred_on, reason, notes
```

Every table includes `id`, `user_id`, `created_at`, `updated_at`, `raw jsonb` for forward-compat fields, an `updated_at` trigger, and the standard `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated; GRANT ALL … TO service_role;` block. No `anon` grants — this is private data.

RLS policies use `auth.uid() = user_id` for select/insert/update/delete on every table.

## Server layer

New `src/lib/food.functions.ts` with `createServerFn` + `requireSupabaseAuth` for:

- `listCrops`, `upsertCropPlanting`, `deleteCropPlanting`, `addHarvest`, `deleteHarvest`
- `listLivestock`, `upsertAnimal`, `deleteAnimal`, `addLivestockEvent`, `deleteLivestockEvent`
- `listProcessingBatches`, `upsertBatch`, `deleteBatch`, `setBatchInputs`
- `listFoodStorage`, `upsertFoodStorageItem`, `deleteFoodStorageItem`, `recordStorageMove`

Reads return plain DTOs joined for the UI (e.g. `CropPlantingWithHarvests`, `BatchWithInputs`).

## UI

- `src/routes/food.tsx` — layout route with sub-tab nav + `<Outlet />`, plus a small "this week" overview (recent harvests, open batches, low-stock storage items).
- One route file per sub-tab, each with:
  - A table/list view of records with filter + sort
  - "New" / "Edit" dialog driven by react-hook-form + zod
  - Inline quick actions (record harvest, log event, log move) using the same dialog pattern
- All dialogs follow the existing `AssetDialog` / `ConsumableDialog` style so it feels consistent with the rest of the app.

## Activity log & reports

- Every create/update on the new tables also writes a row to `activity_log` (using the existing entry-type pattern) so harvests, processing runs, and storage moves show up in Today and roll into weekly / monthly reports automatically — no separate summary plumbing needed.

## Technical notes

- One migration per domain (4 migrations) to keep approval diffs reviewable. Each migration creates its table(s), grants, RLS, policies, and `updated_at` trigger.
- Generated Supabase types refresh after each migration, then the matching `food.functions.ts` slice and route file land in the same turn as that migration.
- No new dependencies; reuses `@tanstack/react-query`, `react-hook-form`, `zod`, shadcn `Dialog` / `Table` / `Tabs` already in the project.
- No edge functions, no service-role usage — pure user-scoped RLS through `requireSupabaseAuth`.

## Out of scope for v1 (call out so we agree)

- Sales / customers / orders (you didn't pick it).
- Cost accounting / P&L per batch.
- Barcode scanning for food storage (can reuse existing scanner later).
- Multi-user / farm-share visibility — everything is per-user only.

If this matches what you want, I'll start with the crops migration + `/food/crops` and work through the four sub-tabs in order.
