# FarmOps Product Architecture

Design document, version 1.0. This describes how FarmOps is abstracted into a
sellable product. It is **design only** — nothing in this document is enforced
by running code yet. The structured version of the same material lives in
`src/lib/product-architecture.ts` and renders in-app at
`/docs/product-architecture`, so the two cannot drift.

Prices in this document are **anchors for discussion**, not live prices.

---

## 1. Product shape

```text
FarmOps OS  (platform, always required)
  └── Knowledge Base            free forever, capped  (default add-on)
  └── Paid add-ons              Electrical, Food, Inventory, Maintenance
        └── Standalone editions Customer (single site) / Contractor (multi-site)
```

### 1.1 FarmOps OS base modules

Every edition ships the OS. These are the modules that make FarmOps a platform
rather than a farm app, listed with purpose, who administers them, what they
gate, and what already exists in the codebase today.

| Module | Purpose | Administered by | Gates | Today |
| --- | --- | --- | --- | --- |
| Licensing & entitlement service | Resolve edition, add-ons, seats and support window — online or offline | Vendor | Add-on routes, metered AI, seat creation, upgrade delivery | `app_entitlements`, `app_addons`, `requireAddon()` cover per-user grants. No edition, key or seat concept |
| AI configuration, routing & billing | Engine choice per feature, metering, cloud pricing, spend caps, cost-before-run | Admin | Cloud escalation offers, feature toggles, usage caps | Built: `ai-routing`, `ai-engines`, `ai-metering.server`, `ai-usage`, `ai-pricing`, `ai_feature_toggles` |
| User management | Roles, invitations, per-module grants, revocation and abuse lockout | Admin | All RLS via `user_roles`; add-on grants | Built: `user_roles` + `has_role()`, revocation counter, one-year lockout |
| Configuration management | Environment/tenant settings, feature toggles, versioned config with audit | Admin | Feature visibility, integrations, units, self-host mode | Partial: `config.server`, `self-host.functions`. No versioned config history |
| Deployment & installation management | Installers, upgrade channel, migration state, preflight, health | Operator | Upgrade download, destructive migrations | Built: Dockerfile, compose, `bootstrap-selfhost.sh`, preflight, `/api/public/health`, `/ready` |
| Data quality management | Reconciliation with an explicit authority model and preview→approve→apply gates | Admin | Every bulk write, import and repair | Built for Electrical: grid data quality, contract v3 reconciliation, mapping repair, apply gates |
| Backup, restore & DR | Scheduled exports, snapshot integrity, restore drills | Operator | Restore, key export | Built: `vault-backup.sh`, `restore-snapshot.mjs`, integrity tests, `DISASTER_RECOVERY.md` |
| Vault | Server-encrypted personal/shared secrets, key wrap, rotation, export audit | Owner | Secret read/write, key export, rotation | Built: `vault_secrets`, key wrap credentials, export audit, `/vault` |
| Audit & change history | One immutable change log every module writes to | Admin | Nothing — records, never blocks; no delete path | Built for Electrical: `electrical_change_audit`. Not generalised |
| Import/export & API layer | Versioned read-only API plus narrowly scoped writes, with OpenAPI | Admin | Bearer + entitlement; applies need approval | Built for Electrical: `/api/electrical/v1`, OpenAPI, `docs/ELECTRICAL_API.md` |
| Observability & support | Diagnostics, log capture, support bundles | Operator | Log access, support bundle export | Built: `diag-logs`, `collect-logs.sh`, `diagnose.sh` |
| Notification & email | Transactional email, auth templates, sending domain | Admin | Outbound send, template edits | Partial: `app-email.functions`. No per-tenant sending domain |

### 1.2 Add-ons

| Add-on | Tier | Scope | Standalone-capable |
| --- | --- | --- | --- |
| Knowledge Base | Free | Procedures, manuals, ingest, search | Yes |
| Electrical Infrastructure | Paid | Panels, feeders, raceways, loads, breaker positions, grid maps, labels, QA, reconciliation, field observations, API | Yes |
| Food & Growing | Paid | Crops, plantings, harvests, seasons, preservation, food plan, irrigation | Yes |
| Inventory | Paid | Items, components, kits and deployments, consumables, imports | Yes |
| Maintenance | Paid | Assets, schedules, records, symptom diagnosis, forecasting | Yes |

Knowledge Base ships enabled by default and free forever. It is the on-ramp:
a new account gets something useful immediately and learns the OS shell
(users, vault, backup, config) before it ever sees a paywall.

---

## 2. Commercial model

### 2.1 Editions

| Edition | Model | Price anchor | Seats | Sites | Add-ons | AI |
| --- | --- | --- | --- | --- | --- | --- |
| Free — Knowledge Base | Free | $0 forever | 2 | 1 | KB only | 25 cloud runs/mo, or unlimited self-hosted |
| Cloud — Homestead | Subscription | $19/mo · $190/yr | 5 | 1 | KB + any 1 paid | 500 cloud runs/mo, metered overage |
| Cloud — Pro | Subscription | $49/mo · $490/yr | 15 | 3 | KB + all paid | 2,500 runs/mo, BYO key allowed |
| Cloud — Contractor | Subscription | $99/mo + $9/mo per managed site | 25 staff | Unlimited, metered | Electrical multi-site + all add-ons on own site | 5,000 runs/mo pooled |
| Self-host — Standard | Perpetual | $899 one-time, 12 mo upgrades | Unlimited | 1 | KB + purchased add-ons | Self-hosted unlimited; cloud needs own key |
| Self-host — Contractor | Perpetual | $1,899 one-time, 12 mo upgrades | Unlimited | Unlimited isolated sites | Electrical multi-site + spawn rights | Self-hosted unlimited; cloud via own key |
| Standalone — Customer | Perpetual | $0 when spawned under Contractor; $249 standalone | 3 | 1 | Exactly one add-on's scoped data | No cloud AI by default |

### 2.2 Self-host, one-time purchase

A perpetual license for the purchased major version, including the first
12 months of quarterly upgrade releases. After year one, an optional
maintenance fee ($199/yr Standard, $349/yr Contractor) restores upgrade
delivery and vendor support.

**A lapsed maintenance date stops new versions. It never disables a running
install, locks data, or degrades a feature already in service.** That rule is a
non-goal in §5 precisely because it is the thing self-hosting buyers fear.

### 2.3 Cloud subscription

Monthly and yearly (yearly ≈ two months free) at the breakpoints above.
Priced as OS base + add-ons, with seat, site and AI-usage caps per tier.

- Overage: cloud AI beyond the tier cap is billed at published token cost + 20%, shown before the run using the existing estimate/escalation flow.
- Trial: 14 days on Homestead or Pro, no card, downgrades to Free KB on expiry.
- Downgrade/expiry: read-only + export for 60 days, then archive. Export is never blocked.

### 2.4 License key claims (self-host and standalone)

Signature-verified, offline-checkable. The key asserts:

```text
license_id          stable, printed on the invoice
edition             one of the perpetual or standalone editions
modules             licensed add-on keys
seats               max concurrent named users (0 = unlimited)
sites               max isolated customer sites
issued_at
version_ceiling     the major version this perpetual grant covers
maintenance_through last date upgrades and support are entitled
spawn_rights        may this install issue Customer-edition grants
signature           vendor Ed25519 signature over the claim set
```

Rules:

- Verification is offline; the public key ships with the binary, so an air-gapped farm never phones home.
- Expired cloud subscription → read-only + export for 60 days before archive.
- Seat and site ceilings block creating the next one; they never evict an existing one.
- Clock tampering is tolerated with a 30-day grace band rather than a hard fail, so a wrong RTC never bricks a shop install.
- Every license decision is written to the audit log with the claim set that produced it.

### 2.5 Billing rails — Stripe

| Flow | Trigger | Effect |
| --- | --- | --- |
| Subscription created | `checkout.session.completed` / `customer.subscription.created` | Write `app_entitlements` rows for the tier's add-on keys, `status = active`, `expires_at = current_period_end` |
| Renewal | `invoice.paid` | Extend `expires_at`; no user-visible action |
| Payment failure | `invoice.payment_failed` after retries | Status → `expired`; UI read-only + export; nothing deleted |
| Self-host purchase | One-time checkout | Issue and email a signed license key; record it for reissue |
| Maintenance renewal | Annual maintenance invoice paid | Reissue key with new `maintenance_through`; upgrade channel reopens |
| Per-site contractor billing | Contractor adds a managed site | Add a metered subscription item; removal stops billing at period end |
| Revenue share | Customer pays directly for an electrician-introduced site | Stripe Connect transfer of the agreed share (anchor: 20% of net while the electrician remains service provider) |

Billing writes entitlements; the app only ever reads them. One billing port
(`createCheckout`, `resolveEntitlements`, `onProviderEvent`) keeps Stripe
replaceable. Self-host installs never call the billing port — they resolve
entitlements from the license key.

---

## 3. Add-ons as standalone applications

Each add-on can ship as a standalone application carrying only its own scoped
data plus the minimum OS services: auth, licensing, vault, backup/restore,
export, data quality and audit.

### 3.1 Two license types

**Customer edition** — one site per instance. This is the hand-over target:
the customer owns and edits their scoped data, produces exports, and runs
backup/restore. No contractor tooling, no spawn rights, no other add-ons.

**Contractor edition** — many customer sites in one instance with per-site
isolation, plus the right to spawn a Customer-edition instance for any site
and hand it over.

### 3.2 Hand-over package

- Scoped dataset for exactly one site, stable IDs unchanged
- Attachments and nameplate photos with checksums
- Full change/audit history for those records
- Canonical design values and as-built values kept in separate fields
- A Customer-edition license grant, or an activation code for one
- Integrity manifest: row counts per table, SHA-256 of the bundle
- Human-readable hand-over report listing unresolved and field-confirmation-required records

### 3.3 Spawn flow

```text
1. Select site      contractor picks one customer site
2. Preview          bundle built read-only; report shows counts, unresolved, withheld
3. Approve          contractor confirms scope; approval is audited
4. Spawn            cloud: provision Customer tenant + import
                    self-host: signed bundle + activation code handed over
5. Transfer         customer account becomes owner; contractor access becomes
                    an explicit, revocable grant — never implicit
6. Reconcile        both sides check the manifest; mismatch blocks completion
```

### 3.4 Electrician deployment and revenue models

| Model | How it works | Revenue |
| --- | --- | --- |
| Self-hosted contractor | One-time Self-host Contractor license; records live on the electrician's box; Customer spawns handed out at project close | License + annual maintenance |
| Cloud-managed customer accounts | Electrician pays the per-site cloud fee to keep continuous records under ongoing service agreements | Base subscription + per-site metered fee |
| Customer-paid with revenue share | Customer subscribes for their own site; electrician stays attached as service provider | Customer subscription minus Connect payout to the electrician |

---

## 4. Migration paths

```text
Standalone (customer)  →  Self-host FarmOps OS  →  Cloud subscription
        ↘                        ↕                      ↙
             portable export bundle + license transfer
```

Fixed rules:

- Stable IDs (`PNL-*`, `CON-###`, `EMT-###`, `JB-###-##`, `BR-###-##-##`, `FS-###`) survive every migration unchanged.
- Audit history migrates with the records; it is never truncated to fit a target schema.
- Canonical/design values are never overwritten by as-built values during import, and vice versa.
- Newer field evidence is never overwritten by an older bundle.
- Every migration is preview → approve → apply with a per-record reconciliation report.
- A migration is reversible by restoring the pre-migration bundle; bundles are retained 90 days.
- Unresolved, interval and mobile/non-fixed locations stay unresolved — migration never invents coordinates.

---

## 5. Boundaries and non-goals

- No canonical ODS write-back from any edition.
- No unrestricted database mutation endpoint, in any edition or API version.
- No collapsing design, provisional and verified as-built locations into one field.
- No add-on reading another add-on's data in a standalone build.
- No license mechanism that can silently disable or degrade a self-hosted install already in service.
- No telemetry phone-home requirement for self-host license validation.
- No seat/site enforcement that deletes or evicts existing records or users.

---

## 6. Gap analysis against today's codebase

| Capability | Exists today | Missing | Phase |
| --- | --- | --- | --- |
| Edition concept | Per-user add-on keys in `src/lib/addons.ts`, `app_entitlements` rows | Edition/plan record bundling add-ons, seats, sites, caps; resolution order edition → add-on → user grant | 1 |
| License key issuance & verification | Nothing — grants are admin-written rows | Signed claim set, Ed25519 verify at boot, offline grace band, reissue on renewal | 1 |
| Tenant / site scoping | Single-farm assumption; RLS by `auth.uid()` and roles | `site_id` on scoped tables + RLS by site membership — prerequisite for Contractor multi-site | 2 |
| Stripe billing | AI cost metering and internal usage bill (`ai-metering.server`, `ai-usage-bill.tsx`) | Checkout, subscription webhooks writing entitlements, one-time license purchase, Connect payouts | 2 |
| Usage caps & overage | Per-run pricing, `ai_usage_events`, `ai-pricing.ts` | Cap enforcement per tier, overage authorisation, cap-reached UX | 2 |
| Generalised audit log | `electrical_change_audit` + `recordElectricalChange`, `activity_log` | One module-agnostic change log with the same before/after contract | 3 |
| Standalone packaging | Docker image, compose, bootstrap script, add-on route gating | Per-add-on build target omitting other modules; standalone shell with minimum OS services | 3 |
| Spawn / hand-over tooling | Snapshot export, `restore-snapshot.mjs`, integrity tests, API document bundle | Site-scoped bundle builder, integrity manifest, activation codes, ownership transfer, hand-over report | 4 |
| Migration between models | Preview→approve→apply gates proven in Electrical | Generic bundle importer applying the §4 migration rules across add-ons | 4 |

### Suggested build order

1. **Phase 1 — Licensing core:** edition records, license claim set, verification, entitlement resolution order. No pricing yet.
2. **Phase 2 — Commerce:** Stripe checkout and webhooks, tier caps and overage, per-site metering, Connect payouts.
3. **Phase 3 — Modularisation:** generalised audit log, per-add-on build targets, standalone shell, site scoping enforced in RLS.
4. **Phase 4 — Portability:** site-scoped bundles, spawn and hand-over, migration importer in both directions.
