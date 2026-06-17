# CSV Import/Export on Every Data Page

Goal: every page that displays user data exposes both a "Import CSV" and "Export CSV" button using a consistent pattern.

## Current state

Already have CSV import (Papa.parse) on: Dashboard (assets), Maintenance, Inventory, Food Storage, Food Orchard, Food Livestock, Food Garden.
Already have CSV export helpers in `src/lib/csv.ts` (`rowsToCsv`, `downloadCsv`).
No page currently combines both — exports are inconsistent, several pages have neither.

## Pages to cover

Data pages getting both Import + Export buttons:

1. Dashboard — assets (import exists, add export)
2. Inventory — inventory_items (import exists, add export)
3. Maintenance — maintenance_records (import exists, add export)
4. Service Scheduling — consumables + schedules (add both)
5. Projects — projects (add both)
6. Tasks (Today / Backlog / Scheduled) — tasks (add both, shared toolbar on each)
7. Food / Plan — food_plan_foods + food_plan_entries (add both)
8. Food / Storage — food_storage_items + food_storage_plan (import exists, add export)
9. Food / Prices — food_price_history (add both)
10. Food / Garden — garden_plots (import exists, add export)
11. Food / Orchard — orchard_trees (import exists, add export)
12. Food / Livestock — livestock_animals (import exists, add export)
13. Food / Crops — crop_plantings + crop_harvests (add both)
14. Food / Processing — processing entries (add both)
15. Food / Seasons — seasonal data (add both)
16. Reports — read-only aggregates: export only (no import)
17. Admin / Users — user list: export only

Skipped (no tabular data or not user-owned): Auth, Sync, Notes (date journal), Food index landing, Tasks detail.

## Shared building block

New `src/components/csv-toolbar.tsx`:

- Props: `filename`, `columns: { key; label }[]`, `rows: Record<string, unknown>[]`, `onImport?: (rows) => void`, `importTemplate?: string[]`, `disabled?`.
- Renders two buttons ("Import CSV" hidden when `onImport` omitted, "Export CSV" always).
- Export uses `rowsToCsv` + `downloadCsv` from `src/lib/csv.ts`.
- Import uses `Papa.parse` with `header: true`, trims values, calls `onImport(parsed)`; toasts on parse error.
- Same look as existing buttons (outline, sm, Upload/Download lucide icons).

Each route imports the toolbar once, defines its column list, and (where applicable) provides an `onImport` that calls the matching server function. For tabs with multiple datasets (Plan, Storage, Crops), one toolbar per dataset.

## Server functions

For pages that currently only had export (or neither), add a bulk-upsert `createServerFn` in the existing `*.functions.ts` file mirroring the pattern in `bulkUpsertGardenPlots`:

- `bulkUpsertProjects`, `bulkUpsertTasks`, `bulkUpsertConsumables`, `bulkUpsertSchedules`, `bulkUpsertFoodPlanFoods`, `bulkUpsertFoodPlanEntries`, `bulkUpsertFoodPriceHistory`, `bulkUpsertCropPlantings`, `bulkUpsertCropHarvests`, `bulkUpsertProcessing`, `bulkUpsertSeasons`.
- Each validates with Zod, uses `requireSupabaseAuth`, scopes writes to `auth.uid()`, returns `{ inserted }`.
- Reports + Admin Users export only — no bulk-upsert needed.

## Out of scope

- Schema-evolving "smart" imports — columns must match export headers (template downloadable via Export with empty filter).
- Image/binary fields are skipped in export.
- No background jobs or progress UI for huge files; client-side parse like today.

## Technical notes

- Reuse `Papa` (already a dep) and `src/lib/csv.ts`.
- Keep the existing import handlers on pages that already have them — just swap their button row to render the new toolbar to avoid duplication.
- Add a small `csvColumns` constant near each page's table definition so export columns stay in sync with what's shown.
- No DB migrations required; bulk-upsert fns hit existing tables with existing RLS policies.

## Rollout order

1. Build `csv-toolbar.tsx` + wire it into the 7 pages that already import.
2. Add export-only to Reports + Admin Users.
3. Add bulk-upsert server fns + toolbars to remaining pages, grouped by `.functions.ts` file to minimize churn.
