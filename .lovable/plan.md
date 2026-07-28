
# AI-Assisted Actions: Planner + Executor

## Trade-off summary (why not use local Ollama as the "executor")

Your instinct — "smart cloud AI researches, local AI writes to the DB" — is a real pattern (called planner/executor or Toolformer-style handoff). But there's a nuance that changes the design:

- **The "executor" doesn't need to be an LLM.** Once the planner emits a structured schedule (JSON: intervals, tasks, parts), inserting rows is deterministic code — a `for` loop over `service_scheduling.insert()`. Adding a second LLM there adds latency, cost, and failure modes without adding capability.
- **Small local models are unreliable at tool-calling.** `llama3.2:1b` (the size that fits your VPS since 3b OOMs) frequently malforms tool JSON. You'd end up validating + retrying + showing a preview anyway.
- **Safety comes from the approval gate, not the model.** A human "Apply" click is a stronger guardrail than a second model — and it's auditable.

**Recommended:** ChatGPT (or any configured planner model) → structured JSON → **preview dialog** → user clicks Apply → typed server function writes rows. This is what "planner + executor" looks like in practice, and it works identically whether you point at OpenAI, Gemini, or local Ollama.

If you later want the local model in the loop, we can add it as a **cheap validator/normalizer** step (rewrites units, dedupes tasks) — but that's phase 2, not required for value today.

## What we're building

A reusable **AI Action Framework** + its first consumer, the **Tractor Maintenance Schedule Generator**.

### Framework (reusable across Food, Maintenance, Irrigation, Procedures)

```text
User intent  ─▶  Planner call (Zod-schema output)  ─▶  ActionPlan JSON
                                                            │
                                                     Preview dialog
                                                     (edit / approve)
                                                            │
                                                    Typed apply()  ─▶  DB rows
                                                            │
                                                     Audit log entry
```

Pieces:
- `src/lib/ai-actions/types.ts` — `ActionPlan<T>` generic + discriminated action union.
- `src/lib/ai-actions/planner.server.ts` — wraps `generateText` + `Output.object`; retries on schema failure; falls back to `error.text` parse per gateway guidance.
- `src/lib/ai-actions/registry.server.ts` — maps `action.type` → typed executor function (`createMaintenanceSchedule`, `addServiceInterval`, `logPreservationBatch`, …). Executors are ordinary server code, not AI.
- `src/lib/ai-actions/apply.functions.ts` — one `applyActionPlan` server fn that iterates the plan, dispatches to registry, returns per-action success/error.
- `src/lib/ai-actions/audit.ts` — writes to a new `ai_action_log` table (who, when, plan JSON, results).
- `src/components/ai-action-preview.tsx` — shared preview UI: renders the plan grouped by action type with per-row edit + omit checkboxes, "Apply N actions" button, streams results back.

### First consumer: Tractor Maintenance Schedule Generator

Route: `/maintenance/generate-schedule` (also linked from asset detail).

Flow:
1. User picks an inventory item flagged as an asset (make / model / year / hours / miles pre-filled from the row).
2. Optional free-text ("used for brush hogging, heavy dust").
3. Planner call with a **structured schema**:
   ```ts
   z.object({
     asset_summary: z.string(),
     intervals: z.array(z.object({
       name: z.string(),                    // "Engine oil & filter"
       trigger_type: z.enum(['hours','miles','months']),
       interval_value: z.number(),          // 100
       first_due_at_hours: z.number().nullable(),
       tasks: z.array(z.string()),          // ["Drain oil", "Replace filter", ...]
       parts: z.array(z.object({
         name: z.string(),
         quantity: z.number(),
         match_inventory_hint: z.string().nullable(),   // fuzzy match target
       })),
       notes: z.string().nullable(),
     })),
     citations: z.array(z.string()),        // "manufacturer typical" / user context
   })
   ```
4. Server enriches: for each `parts[].match_inventory_hint`, run a like-search against `inventory_items` for the current user and attach a suggested `inventory_item_id` (nullable).
5. Preview dialog renders intervals as cards; user can:
   - Toggle any interval off.
   - Edit interval values inline.
   - Confirm or clear each part's inventory match.
6. On Apply, `applyActionPlan` writes:
   - One row per interval into `service_scheduling` (linked to the asset).
   - Optional `procedure_links` rows for parts confirmed against inventory items.
   - One `ai_action_log` row with the full plan + result.

### Planner model selection

- Default: whatever `createAiProvider` resolves — this already honors `CUSTOM_AI_BASE_URL` / `CUSTOM_AI_API_KEY` / `CUSTOM_AI_MODEL`, so your existing OpenAI/Gemini/Ollama switch keeps working.
- No new secrets required.

## Technical details

- **New table** `ai_action_log` (public schema, RLS + grants per project rules):
  ```sql
  create table public.ai_action_log (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    surface text not null,             -- 'maintenance.generate_schedule'
    plan jsonb not null,
    result jsonb,
    status text not null default 'pending',   -- pending|applied|failed|partial
    created_at timestamptz not null default now(),
    applied_at timestamptz
  );
  grant select, insert, update on public.ai_action_log to authenticated;
  grant all on public.ai_action_log to service_role;
  alter table public.ai_action_log enable row level security;
  create policy "own rows" on public.ai_action_log
    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  ```
- **Schema guardrail:** no `.min()/.max()` inside `Output.object` — bounds go in the prompt and are validated in code after parse (per gateway rules). Wrap the call in `NoObjectGeneratedError.isInstance(error)` fallback that parses `error.text`.
- **Executor signature:** `type Executor<T> = (input: T, ctx: { supabase, userId }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>`.
- **Idempotency:** apply endpoint accepts a client-generated `plan_id` (uuid); re-submitting the same plan_id returns the prior result instead of re-inserting.
- **No changes to Consultant chat** — the consultant stays read-only. This framework is opt-in per surface.
- **Files touched:**
  - New: `src/lib/ai-actions/{types,planner.server,registry.server,audit,apply.functions}.ts`, `src/lib/maintenance-schedule-planner.functions.ts`, `src/components/ai-action-preview.tsx`, `src/routes/maintenance.generate-schedule.tsx`, migration `add_ai_action_log`.
  - Edited: `src/routes/maintenance.tsx` (add "Generate schedule with AI" card), `src/routes/inventory.$id.tsx` if present (add button on asset detail).

## What's explicitly out of scope

- Local-Ollama-as-executor (adds fragility for no gain — revisit only if we later want offline-only mode).
- Auto-apply / no-approval mode (safety).
- Extending to Food/Irrigation/Procedures in this pass — framework is designed for it, but only Maintenance ships in v1.

## Verification

1. Generate schedule for a real tractor row → preview shows ~6-10 intervals with parts.
2. Toggle two intervals off, edit one interval value → Apply → confirm only selected rows land in `service_scheduling` with edited values.
3. Re-submit same `plan_id` → returns cached result, no duplicate inserts.
4. Force a schema violation (long enum in prompt) → fallback parse path handled without a 500.
