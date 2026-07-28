# Maintenance Forecaster + Symptom → Procedure

Two AI-assisted features for the Maintenance module, both powered by the same loaded gateway model (`google/gemini-3.6-flash` default, honoring `CUSTOM_AI_BASE_URL` on self-host).

---

## Feature 1 — Maintenance forecaster

Predicts the next 30 / 60 / 90-day service list per asset from `inventory_items` usage (`current_hours`, `current_miles`, `usage_tracking`) and historical `maintenance_records` intervals.

### How it works

1. **Deterministic pre-compute** (no AI):
   - For each `inventory_item` where `usage_tracking IN ('hours','miles')`, look at completed `maintenance_records` for that asset.
   - Group by `service_type`; compute average interval (Δhours / Δmiles / Δdays between `performed_at` values).
   - Estimate daily usage rate from the last 90 days of `current_hours`/`current_miles` deltas (snapshotted via a lightweight `asset_usage_snapshots` table — see below).
   - Project when each service is next due (hours or miles) and translate to a calendar date via the usage rate.
   - Bucket into 30 / 60 / 90-day windows.
2. **AI overlay** (gateway call):
   - Feed the projected list + linked procedures + recent notes to the model with an `Output.object` schema.
   - Model returns prioritized narrative ("Tractor #2 hydraulic filter is 40 hrs past interval — do first"), suggested prep parts pulled from `inventory_items` and `procedure_links`, and any anomaly callouts (e.g. usage rate spiked).
   - Deterministic list is the source of truth; AI never invents services not in the computed list.

### Data model

New table `public.asset_usage_snapshots` — tracks usage over time so we can derive rate:

```text
id uuid pk
user_id uuid
inventory_item_id uuid → inventory_items
recorded_at timestamptz
hours numeric | miles numeric
```

Auto-snapshot via a `BEFORE UPDATE` trigger on `inventory_items` whenever `current_hours`/`current_miles` changes.

### Server functions (`src/lib/maintenance-forecast.functions.ts`)

- `getForecast({ horizonDays? })` — returns `{ assets: [{ asset, dueItems: [{service, dueDate, basis, daysOut, linkedProcedureId, requiredParts[]}], usageRate, aiNarrative? }] }`.
- `refreshForecast({ withAI: boolean })` — recomputes and caches per user.

### UI

New route `src/routes/maintenance.forecast.tsx` (linked as a tab on `/maintenance`):

- Three columns: **Next 30 days**, **60 days**, **90 days**.
- Each card shows asset, service type, due date + basis ("in 12 hrs / on Aug 14"), linked procedure, and a "Parts to stage" list resolved from `procedure_links` → `inventory_items` with stock warnings.
- "Regenerate with AI insights" button; results cached until next usage update.
- Empty-state guidance when an asset has no historical intervals ("record 2+ services to enable forecasting").

---

## Feature 2 — Symptom → procedure

Free-text machine issue in → matching procedure(s), parts list, and a proposed maintenance record.

### How it works

1. **Retrieval step**: pull candidate procedures via keyword match on `procedures.name`/`content` + assets from `inventory_items` matching mentioned nouns. No vector DB yet; simple ILIKE + trigram is enough for the current dataset size.
2. **AI classification**: send the symptom, top ~15 candidate procedures (title + first 400 chars), and the user's inventory to the model with a strict `Output.object` schema:
   ```text
   {
     matchedProcedureId: uuid | null,
     confidence: 'high'|'medium'|'low',
     reasoning: string,      // one sentence
     suspectedAssetIds: uuid[],
     partsFromInventory: [{ inventory_item_id, name, quantity, in_stock }],
     partsMissing: [{ name, reason }],
     suggestedMaintenanceRecord: { title, service_type, description }
   }
   ```
3. **Guardrails**: if `confidence === 'low'` or `matchedProcedureId === null`, show a "no confident match — create new procedure?" path instead of guessing.

### Server function (`src/lib/maintenance-symptom.functions.ts`)

- `diagnoseSymptom({ text, assetIdHint? })` — validates input (Zod, 1–2000 chars), retrieves candidates, calls gateway, returns the shape above.
- `createRecordFromDiagnosis({ diagnosisId })` — atomically inserts a `maintenance_records` row + `procedure_links` if user accepts.

### UI

New card on `/maintenance` **and** a right-rail panel on any inventory item page:

- Textarea + "Diagnose" button.
- Result panel: matched procedure (clickable), confidence chip, one-line reasoning, parts checklist split into "In stock" / "Need to order", "Create maintenance record" and "Log to today's note" buttons.
- Recent diagnoses history (last 10) for quick reuse.

---

## Shared plumbing

- Both features go through the existing `createLovableAiGatewayProvider` helper in `src/lib/ai-gateway.server.ts` — no new secrets.
- Structured output uses AI SDK `Output.object` with small Zod schemas (no `.min/.max` bounds; length limits stated in the prompt and clamped in code per the SDK guidance).
- Errors: 402/429/validation are surfaced as toast + inline message, not swallowed.
- All server functions are `.middleware([requireSupabaseAuth])`; RLS scopes rows by `user_id`.
- Nav: add "Forecast" and "Diagnose" tabs to the existing `/maintenance` layout.

## Files touched

- `supabase/migrations/…_asset_usage_snapshots.sql` — new table, GRANTs, RLS, snapshot trigger on `inventory_items`.
- `src/lib/maintenance-forecast.functions.ts` (new)
- `src/lib/maintenance-symptom.functions.ts` (new)
- `src/lib/maintenance-forecast.server.ts` (new — interval math, AI prompt builder)
- `src/lib/maintenance-symptom.server.ts` (new — candidate retrieval)
- `src/routes/maintenance.forecast.tsx` (new)
- `src/routes/maintenance.diagnose.tsx` (new)
- `src/routes/maintenance.tsx` — add tabs
- `src/components/maintenance/ForecastBoard.tsx`, `DiagnosisPanel.tsx` (new)

## Out of scope (call out if you want them added)

- Semantic search via embeddings (would replace ILIKE retrieval — bigger change).
- Auto-creating purchase orders for missing parts.
- Photo-based symptom input (multimodal) — easy to add later on the same endpoint.

**Ready to build on approval.**