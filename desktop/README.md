# FarmOps Desktop

Electron shell for the Windows and Linux client, isolated from the hosted application.

Run the existing FarmOps UI locally, set `FARMOPS_DESKTOP_URL`, then run `npm install`, `npm test`, and `npm start` here.

Profiles live below Electron's OS-specific user-data directory under `profiles/live`, `profiles/demo`, and `profiles/blank`. Installation and device identity live above profile data so clearing a site cannot restart a trial.

Packaging targets Windows NSIS and Linux AppImage. CI artifacts are unsigned test builds; release signing and backup-first updates are separate backlog items.

## Reset boundary

The generic lifecycle API may reset Demo or Blank profiles only. Live Farm clearing must use the separate audited, backup-first workflow; callers cannot route Live data through the disposable-profile reset.
