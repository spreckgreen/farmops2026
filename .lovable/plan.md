# Preservation Coach

Given a harvest batch (crop + quantity/unit), recommend a preservation method (can / freeze / dehydrate), estimated jar/bag counts, and surface the best matching procedure from the user's procedures library. Optionally log the result as a food storage item.

## Access points

- New route `/food/preserve` with crop-picker or manual entry.
- New **"Preserve"** button on each harvest row in `src/routes/food.crops.tsx` that deep-links to `/food/preserve?harvestId=…` with quantity/unit prefilled.

## Backend — `src/lib/preservation-coach.functions.ts`

Two server functions, both `requireSupabaseAuth`:

1. `recommendPreservation({ crop, variety?, quantity, unit, targetShelfMonths? })`
   - Deterministic pre-compute (no AI needed for math):
     - Convert quantity → pounds using a small lookup + optional heuristic for count units (per-item avg weight for common crops).
     - Compute yields for each method from a table (see below): quart jars, pint jars, freezer-bag pounds, dehydrated ounces.
   - Retrieve top procedures via keyword search over `procedures.name/content` (same pattern as `maintenance-symptom.functions.ts`) — allowlist for the model.
   - Call Lovable AI Gateway (`google/gemini-3.6-flash`) with `Output.object` schema (constraint-free — limits stated in the prompt, clamped in code, wrapped in `NoObjectGeneratedError` guard per `ai-sdk-agent-patterns`) returning:
     - `primary_method`: `"can_water_bath" | "can_pressure" | "freeze" | "dehydrate" | "ferment" | "cold_store"`
     - `rationale`: short string
     - `alternates`: array of `{ method, rationale }`
     - `safety_notes`: array of strings (e.g. low-acid → pressure only)
     - `procedure_id`: must match one of the allowlisted procedure IDs, or null
     - `storage_item`: `{ name, category, food_type, unit, quantity, best_by_months }` suggestion
   - Validate `procedure_id` and method values server-side against the allowlist/enum before returning.
   - Merge with deterministic yields → final response.

2. `logPreservationBatch({ recommendation, harvest_id? })`
   - Inserts a `food_storage_items` row from `storage_item` (status `available`, acquired_on today, best_by = today + months).
   - Optional `notes` field records the source harvest + chosen method.

Yield table (constants in the file, editable):
```
tomato:      21 lb / 7 qt (water bath)   ·  freezer 1 lb/qt-bag  ·  dehydrator 12:1
green_bean:  14 lb / 7 qt (pressure)     ·  1 lb/qt-bag           ·  10:1
apple:       19 lb / 7 qt sauce          ·  1 lb/qt-bag           ·  8:1
default:     18 lb / 7 qt                ·  1 lb/qt-bag           ·  10:1
```

Low-acid list (force pressure or freeze): green_bean, corn, meat, squash, carrot, potato.

## Frontend — `src/routes/food.preserve.tsx`

- Form: crop (Combobox from user's plantings + free text), variety, quantity, unit, target shelf months.
- Prefill from `?harvestId=…` via `crop_harvests` lookup.
- On submit → show recommendation card:
  - Primary method badge + rationale.
  - Yield summary: "≈ 7 quart jars **or** 14 pint jars **or** 3 lb dehydrated".
  - Safety notes (red callout when low-acid).
  - Alternate methods list.
  - Matched procedure card with link to `/procedures/{slug}` when `procedure_id` is set; "No matching procedure — create one" link otherwise.
  - "Log to food storage" button → calls `logPreservationBatch`.
- History list: last 10 preservation batches for this user (query `food_storage_items` where notes tag `preservation:*`).

## Navigation

Add a "Preserve" link to the `/food` nav row (alongside Crops / Reports) and a per-row action button on `/food/crops` harvest rows.

## Files touched

- **New** `src/lib/preservation-coach.functions.ts`
- **New** `src/routes/food.preserve.tsx`
- **Edit** `src/routes/food.crops.tsx` — add per-harvest "Preserve" button linking to the new route.
- **Edit** `src/routes/food.tsx` (or wherever food nav lives) — add nav link.

No DB migration required — reuses `crop_harvests`, `procedures`, and `food_storage_items`.

## Notes for the non-technical view

- The coach picks the safest preservation method for what you harvested, tells you how many jars to expect, and hands you the matching how-to from your Procedures library.
- One-click "Log to food storage" adds the finished jars to your pantry with a best-by date.
- Low-acid crops (beans, corn, squash) are flagged so you don't water-bath them by mistake.
