## Changes

### 1. Weekly report = week ending Sunday
- `generateSummary({ mode: "weekly_report" })` ignores `period_days` and instead computes the most recent week that ends on Sunday (Mon–Sun). If today is Sunday, today is the week-end; otherwise the previous Sunday is.
- `period_start` / `period_end` stored as that Mon 00:00 → Sun 23:59:59.
- New stored field `display_title` on the summary row = `Status WE YYYYMMDD` (week-ending date).
- Re-runs replace the existing row for that exact week (delete-then-insert keyed on mode + week_end).

### 2. Per-project running summary (existing `project_rollup`)
- Already produces one summary per project from full history. Keep behavior; just give each row a stable `display_title` = `Running Summary — #project/<name>`.
- Continues to delete + re-insert per (mode, scope_project) on each run, so it stays a single running record per project.

### 3. Quarterly rollup — last 2 years
- New mode `quarter_review`. For each of the last 8 quarters (including the current in-progress one), build one summary per project that had any closed task in that quarter.
- Period bounds = quarter start/end. Entries scoped to that quarter's `activity_log`, plus the project's tasks `closed_at` within the quarter to drive "completed in quarter".
- `display_title` = `Quarter Review YYYYQNN — #project/<name>` (e.g. `Quarter Review 2026Q01 — #project/orchard`).
- Triggered by a new "Quarterly review (2y)" button on `/summaries`. Generates all missing quarter/project rows; existing rows for the same (quarter, project) are replaced.

### 4. UI + export plumbing
- `src/routes/summaries.tsx`: add Quarterly button; show `display_title` as the card heading; group/sort by mode then period_end desc.
- `src/lib/tiddlywiki-export.ts`: `summaryTitle()` returns `display_title` when present; falls back to current format. Per-project child tiddlers (added last turn) keep using the project-specific title derived from `display_title`.

## Technical details

- DB: add `display_title text` column to `public.summaries` (nullable; backfill not needed — code falls back when null). Migration runs first.
- `summary.functions.ts`:
  - Add helpers `weekEndingSunday(d)`, `quarterBounds(year, q)`, `lastNQuarters(n)`.
  - Extend `SummaryInput` to accept `mode: "quarter_review"` plus optional `quarter: { year, q }` (when omitted, server iterates last 8).
  - `weekly_report` branch computes Mon–Sun bounds, sets `display_title`, dedupe-replaces on (user, mode, week_end).
  - `quarter_review` branch iterates quarters × projects, only emits a row when that project has any activity or `closed_at` in the quarter; dedupe-replaces on (user, mode, scope_project, period_start, period_end).
- `tiddlywiki-export.ts`: read `display_title`; per-project tiddler title = `${display_title} — #project/${p.project}` when parent has `by_project`, else just `display_title`.

## Out of scope
- No backfill of historical weekly reports.
- AI prompts unchanged except a sentence noting the week/quarter bounds.
