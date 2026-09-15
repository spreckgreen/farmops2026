# FarmOps Desktop

Electron shell for the Windows and Linux client, isolated from the hosted application.

By default the desktop app stays local-only and opens its built-in health/setup screen backed by the desktop SQLite profile. It does not require or load the Supabase web app.

Run `npm install`, `npm test`, and `npm start` here to exercise the standalone Electron path.

Remote web UI loading is now opt-in for development only. To point Electron at a separately running FarmOps web UI, set both `FARMOPS_DESKTOP_URL` and `FARMOPS_DESKTOP_ALLOW_REMOTE_UI=true` before `npm start`.

Profiles live below Electron's OS-specific user-data directory under `profiles/live`, `profiles/demo`, and `profiles/blank`. Installation and device identity live above profile data so clearing a site cannot restart a trial.

Packaging targets Windows NSIS and Linux AppImage. CI artifacts are unsigned test builds; release signing and backup-first updates are separate backlog items.

## Reset boundary

The generic lifecycle API may reset Demo or Blank profiles only. Live Farm clearing must use the separate audited, backup-first workflow; callers cannot route Live data through the disposable-profile reset.
