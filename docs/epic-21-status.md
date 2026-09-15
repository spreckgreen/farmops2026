# Epic #21 Status Tracker

## Epic
FarmOps Desktop distribution, subscriptions, backup, and updates

## Issue
https://github.com/spreckgreen/farmops2026/issues/21

## Purpose
This document records the current implementation status for Epic #21 using repo evidence and branch naming as the source of truth. It is intentionally kept lightweight and factual so it can be reviewed alongside the GitHub issue without relying on branch UI state alone.

## Product outcome
Deliver a standalone Windows and Linux FarmOps client with local data, isolated profiles, a 14-day all-feature site trial, permanent free Procedures access, paid module entitlements, AI provider choices, backup-first updates, and complete local purge controls.

## Epic workstreams and current status

### 1. Desktop shell and profile isolation
Status: In progress

Evidence:
- feature/desktop-update-recovery-...
- feature/desktop-update-session-...
- feature/desktop-update-session-pe...

Assessment:
These branch names indicate active work on desktop-local state and user/session handling, which is consistent with profile isolation and desktop shell foundations.

### 2. Backup archive and backup-first updates
Status: In progress

Evidence:
- feature/desktop-scheduled-backup-...
- feature/desktop-update-recovery-...

Assessment:
The scheduled backup branch and recovery branch directly match the Epic requirement for backup-first update safety and archive/recovery workflows.

### 3. Update recovery and rollback safety
Status: In progress

Evidence:
- feature/desktop-update-recovery-...

Assessment:
This is a direct match to the Epic’s update safety and recovery requirements.

### 4. Session persistence and safe local state
Status: In progress

Evidence:
- feature/desktop-update-session-...
- feature/desktop-update-session-pe...

Assessment:
This aligns with desktop session handling and recovery-safe local data state.

### 5. Validation and integrity checks
Status: In progress

Evidence:
- fix/desktop-scrypt-validation-...

Assessment:
Validation and integrity fixes are a core companion to the Epic’s update and backup safety work.

### 6. Final Windows/Linux packaging and distribution readiness
Status: Pending

Assessment:
The issue explicitly calls out standalone Windows and Linux desktop packaging. There is no clear evidence yet in the branch stream that packaging/distribution is complete.

### 7. Trial / entitlement state machine
Status: Pending

Assessment:
The Epic includes 14-day all-feature trial behavior, paid module entitlements, and trial reset semantics. These are still Epic-level features and are not clearly represented by the current branch names alone.

### 8. AI provider and secure credential architecture
Status: Pending

Assessment:
This appears in the product backlog rather than in the active feature-branch names visible here.

### 9. Trial disclosures and paid-module lock experience
Status: Pending

Assessment:
This is listed in the product backlog and not yet evidenced by the branch stream visible here.

### 10. Subscriptions and one-time paid export
Status: Pending

Assessment:
This is a milestone-level feature area and not yet evidenced by the current branch pattern.

### 11. Clear, new-site, and total purge workflows
Status: Pending

Assessment:
This is a product backlog item and is not clearly represented by the current branch activity.

## Summary assessment

The active branch names align strongly with the Epic’s desktop update, backup, recovery, and safety work. The team appears to be in the middle of the desktop foundation / safety stack rather than at final release readiness.

Current likely status:
- Done or actively underway: desktop update-recovery, backup scheduling, session handling, validation work
- Still pending: final packaging, entitlement logic, subscriptions, paid-module experience, purge workflows, and final release sign-off

## Evidence source
- GitHub issue: https://github.com/spreckgreen/farmops2026/issues/21
- Branch pattern observed in the development UI:
  - feature/desktop-update-recovery-...
  - feature/desktop-update-session-pe...
  - feature/desktop-update-session...
  - fix/desktop-scrypt-validation-...
  - feature/desktop-scheduled-backup-...

## Update policy
This document should be updated when:
- a feature branch is merged to main
- a workstream is verified complete
- the Epic backlog changes
- new evidence appears from PRs or branch naming that materially changes status
