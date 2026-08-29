# Electrical Infrastructure Module — as a gated add-on

## Evaluation of the requirements document

The document is implementable against this codebase as-is: it already assumes TanStack Start, Supabase, React Query, Zod, and the existing RLS/export patterns, all of which are present. Nothing in it conflicts with current architecture.

Three things it does not specify, which this plan settles:

- **Add-on gating.** There is no feature-flag or entitlement layer in the project today (checked — no such tables or code). It has to be built first, otherwise the electrical routes ship as always-on.
- **Multi-tenancy.** Every existing table is owner-scoped by `user_id`. Electrical data will follow the same pattern, and entitlements will be per-user for now, so "subscription" means "this account has the electrical add-on".
- **ODS parsing at runtime.** The app runs on an edge worker with no native binaries, so the parser must be pure JavaScript (unzip `content.xml` and read the XML). Confirmed feasible; heavier spreadsheet libraries that need Node natives are ruled out.

Scope agreed: Phases 1–4 (schema/standards, infrastructure UI, ODS-derived import, field workflow). ODS export/sync, label queue, and cutover stay out of this build; labels get their table but no print pipeline yet.

## What gets built

### 1. Add-on framework (prerequisite)

- `app_addons` catalog (key, name, description) seeded with `electrical`.
- `app_entitlements` — per user, per add-on key, with `status` (active / trialing / expired / disabled), optional `expires_at`, and notes. Admin-managed; no payment provider yet, but the shape is what a billing webhook would write to.
- Server-side gate: a helper every electrical server function calls first, which fails closed when the caller has no active entitlement. Client-side `useAddon("electrical")` hook for nav/route rendering.
- Admin screen at `/admin/addons` to grant, revoke, expire, and trial the add-on per user.
- Electrical nav entry and routes hidden when the add-on is off; a friendly "Electrical add-on not enabled" screen if someone reaches the URL directly.

### 2. Electrical schema (Phase 1)

Tables: `electrical_panels`, `electrical_raceways`, `electrical_raceway_waypoints`, `electrical_junction_boxes`, `electrical_branch_runs`, `electrical_circuit_groups`, `electrical_loads`, `electrical_labels`, `electrical_naming_standards`.

- UUID primary keys internally; human stable IDs (`FS-097`, `PNL-FS-CRIT`, `CON-030`, `JB-014`, `BR-057`) enforced unique per user.
- Foreign keys for every endpoint reference; waypoints are rows on a raceway, never junction-box records.
- One raceway table with an `environment` value (`INTERIOR`, `SITE_UNDERGROUND`, `SITE_EXTERIOR`, `BUILDING_TRANSITION`); Interior/Site are filters, not separate tables.
- Panel exit position stored separately from the stable conduit ID (`exit_order`, `exit_side`, `exit_notes`).
- Installation status as a controlled list covering Planned → As-Built Verified, plus completion percentage and planned vs measured lengths kept as distinct columns.
- Owner-scoped RLS and explicit grants on every table, matching existing project conventions.
- Naming Standards rows seeded with the conventions from the document (A6 = NE, clockwise outside-in, lower-right counterclockwise panel exits, continuous-raceway rule), versioned so a rule change is deliberate.

### 3. Infrastructure UI (Phase 2)

Routes under `/electrical`: Overview, Loads/Circuits, Panels, Raceways, Junction Boxes, Branch Runs, Naming Standards, Installation Progress.

- Entity list + detail pages, mobile-first forms, selection pickers (choose a panel/J-box/load rather than typing a name).
- Topology breadcrumb on every detail page: Panel → Raceway → Junction Box → Branch Run → Load, clickable in both directions.
- Panel view renders breaker positions from that panel's own space count, with the field-friendly Left/Right numbering — no hardcoded 48.
- Farm Shop sort helper implementing A6-NE clockwise outside-in ordering as a display/print order only.

### 4. ODS import (Phase 3)

- Upload the `.ods`, parse `content.xml` in a server function with a pure-JS unzip + XML reader.
- Read `Load_Master`, `Panels`, `Conduit_Runs` (plus `Junction_Boxes` / `Branch_Runs` if present); ignore generated convenience sheets.
- Dry-run first: a migration report showing rows to create/update, duplicate stable IDs, unresolved endpoint references, and proposed raceway merges. Nothing is written until confirmed.
- Raceway classification is a reviewable proposal list — segments split only by a hypothetical pull box are offered for merge with the direction retained as waypoints. No automatic destructive merge.
- Import snapshots recorded so an import can be reviewed after the fact.

### 5. Field workflow (Phase 4)

- Status and measured-length updates from phone-sized forms.
- Work lists: incomplete raceways, unlabeled J-boxes, branch runs awaiting conductor, installed-not-connected, connected-not-tested, 0% circuits, by grid, by panel.
- Stable-ID search that jumps straight to the entity.
- Validation surface listing blocking errors (duplicate IDs, invalid endpoints, conflicting breaker positions) separately from TBD warnings.
- Audit columns on the sensitive fields the document names (panel assignment, breaker position, endpoints, measured length, completion, as-built verification).

## Technical notes

- Schema arrives as Supabase migrations; TypeScript types regenerate after each.
- Server functions in `src/lib/electrical*.functions.ts` using `requireSupabaseAuth`, with the entitlement check as the first line of every handler — gating is enforced server-side, not just hidden in the UI.
- ODS parsing runs inside a server-function handler; parser deps must be pure JS (edge worker, no native modules). If a candidate library turns out to need Node natives, it gets swapped rather than patched.
- Vitest coverage for stable-ID validation, raceway classification, panel position math, Farm Shop walk ordering, and the entitlement gate.
- No writes to generated Markdown or the canonical ODS in this build.

## Delivery order

Each step is a separate reviewable change: add-on framework → schema + standards → infrastructure UI → ODS import → field workflow.
