# Send Reports to Ghost Blog

Add a **"Send to Ghost"** action available on **every report type** on the Reports page, posting to `https://impressive-guan.pikapod.net` as a **draft** by default.

## Behavior
- Each report type (every section/card on Reports) gets its own "Send to Ghost" button.
- Click → dialog: edit title (prefilled), pick **Draft / Published**, optional tag override (default `bostead-report`), Send.
- On success: toast with link to the Ghost post.
- Admin-only (uses existing `has_role` check).

## Secrets needed
- `GHOST_ADMIN_API_KEY` — Ghost Admin API key, format `<id>:<secret>` (you still need to grab this from Ghost Admin → Settings → Integrations → Add custom integration → **Admin API Key**, not Content API).
- `GHOST_API_URL` — `https://impressive-guan.pikapod.net`

The Content API key you sent (`df0b7aa6f87ba37063f67a53ee`) is read-only and can't create posts; the Admin API key is required.

## Implementation

### 1. Shared content builders `src/lib/report-export.ts`
One function per report type that returns `{ title, html }` from the same data the report already renders. Centralized so every report's "Send to Ghost" button produces consistent output.

### 2. Server function `src/lib/ghost.functions.ts`
`sendReportToGhost({ title, html, status, tag })`:
- `requireSupabaseAuth` + `has_role(admin)` check.
- Builds Ghost Admin JWT (HS256, 5-min expiry, `kid` = key id, `aud` = `/admin/`) using Node `crypto`.
- `POST ${GHOST_API_URL}/ghost/api/admin/posts/?source=html` with `{ posts: [{ title, html, status, tags: [tag] }] }`.
- Returns `{ id, url, status }`; throws Ghost's error message on failure.
- Writes an `activity_log` row (`action: 'report.sent_to_ghost'`, details: report type, ghost post id, status).

### 3. UI
- New component `SendToGhostButton` (used by every report card/section): button + dialog (title, status toggle, tag, submit).
- Wired into each report type on the Reports route.
- Button hidden when user isn't admin.

## Out of scope
- Updating/re-syncing already-sent posts (each click creates a new post).
- Uploading report images to Ghost (HTML keeps original URLs).
- Scheduling, auto-publish on report generation, multi-blog targets.

## Verification
- Send one report type as draft → confirm it appears in Ghost admin with correct title/body.
- Repeat for one more report type to confirm shared button works.
- Check `activity_log` has the entry.
