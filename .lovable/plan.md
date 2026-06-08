
# Obsidian-Style Task & Activity Log

Primary interface: a daily-note markdown pane where you type freely. Tasks (`- [ ]`) and tagged entries (`#task/slug` or `[[Task Name]]`) auto-route into a structured append-only activity log. AI summarizer condenses entries on demand.

## What you get

- **Daily note pane** — one markdown doc per day, edits autosave
- **Task sidebar** — all open tasks with status, last activity, jump-to-entry
- **Activity log view** — chronological, filterable by task, with raw + AI-summarized side by side
- **Summarizer** — three modes: task update, project rollup, weekly report
- **Single-user auth** (email/password via Lovable Cloud)

## Data model

```text
tasks
  id, slug, title, status (open|blocked|done), created_at, closed_at, user_id

activity_log               -- append-only, never edited
  id, task_id (nullable), daily_note_id, entry_type
  (status|blocker|decision|commit|meeting|note),
  raw_content, ai_summary (nullable), created_at, user_id

daily_notes
  id, date (unique per user), markdown_content, user_id

summaries
  id, mode (task_update|project_rollup|weekly_report),
  scope_task_id (nullable), period_start, period_end,
  generated_summary (jsonb), edited_summary (jsonb nullable),
  status (draft|reviewed|published), created_at, user_id
```

All tables RLS-scoped to `auth.uid()`. `activity_log` is insert-only from the client (no update/delete policy).

## Entry routing

When the daily note saves, a parser scans for:
- `- [ ] Task title` → creates a `task` row (slug from title)
- `- [x] ...` → marks matching task done + appends a `status` entry
- `#task/<slug> <text>` → appends an entry to that task
- `[[Task Name]] <text>` → same, resolved by title
- `!blocker`, `!decision`, `!commit`, `!meeting` prefixes set `entry_type`
- Untagged lines stay in the daily note only

Parser runs client-side on save; emits a batch of `activity_log` inserts via a server function.

## AI summarizer

One server function `generateSummary({ mode, scope, range })`:
1. Pull `activity_log` rows in range (optionally filtered by task)
2. Pull previous summary for same scope (so the new one extends, not restarts)
3. Build prompt per mode:
   - `task_update` → 2–3 past-tense sentences
   - `project_rollup` → bullets: shipped / blocked / next
   - `weekly_report` → 150–200 word stakeholder narrative
4. Call Lovable AI (`google/gemini-3-flash-preview`) with `Output.object` schema → `{ summary, key_decisions[], blockers[], next_steps[] }`
5. Insert into `summaries` as `draft`

UI: "Summarize" button on each task and a "Weekly report" button on the dashboard. Draft opens in a review panel; edit + mark reviewed/published.

## Routes

```text
/                  → today's daily note (redirect to /notes/YYYY-MM-DD)
/notes/$date       → daily note editor + task sidebar
/tasks             → task list
/tasks/$slug       → task detail: activity log + summarize button
/summaries         → drafts + published summaries
/auth              → login
```

`/notes/$date`, `/tasks/*`, `/summaries` live under `_authenticated` layout.

## Stack & libs

- TanStack Start (existing) + Lovable Cloud (auth, Postgres, RLS)
- `@uiw/react-md-editor` for the daily-note pane (markdown source + preview)
- AI SDK + Lovable AI Gateway, structured output via `Output.object`
- `createServerFn` for: `saveDailyNote`, `parseAndRouteEntries`, `generateSummary`, `listActivity`

## Build order

1. Enable Lovable Cloud + schema migration + RLS + grants
2. Auth (`/auth`) and `_authenticated` layout
3. Daily note editor with autosave (`/notes/$date`)
4. Entry parser + `parseAndRouteEntries` server fn
5. Task list + task detail with activity log
6. AI summarizer server fn + review UI
7. Weekly report dashboard

## Out of scope (later phases)

- Obsidian vault file sync (manual paste/import works for now)
- TinyWiki / `build_history` publishing
- Multi-user workspaces
