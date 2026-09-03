# FarmOps Product Architecture — Design Document

Deliverable for this phase: a written design only. No runtime code, schema, billing, or entitlement changes. Output is `docs/PRODUCT_ARCHITECTURE.md` plus a read-only in-app page at `/docs/product-architecture` that renders the same content so it is browsable inside the app.

## What the document defines

### 1. Product shape

Three layers, named explicitly so pricing and packaging can hang off them:

```text
FarmOps OS  (platform, always required)
  └── Knowledge Base            free forever, capped  (default add-on)
  └── Paid add-ons              Electrical, Food, Inventory, Maintenance
        └── Standalone editions Customer (single site) / Contractor (multi-site)
```

FarmOps OS base modules the doc specifies (each with purpose, who administers it, and what it must gate):

- Licensing & entitlement service — edition + module licenses, license keys, seat counts, expiry, grace periods, offline validation for self-host
- AI configuration, routing & billing — provider/engine config, per-feature routing, metering, usage caps, cost display (already partly built: `ai-routing`, `ai-metering`, `ai-usage`)
- User management — roles, invitations, per-module grants, revocation and lockout rules (already built: `user_roles`, `app_entitlements`)
- Configuration management — environment/tenant settings, feature toggles, versioned config with audit
- Deployment & installation management — installers, upgrade channel, version/migration state, health & readiness checks
- Data quality management — audit/reconciliation framework, authority model (design vs as-built), preview→approve→apply gates
- Backup & restore / disaster recovery — scheduled exports, snapshot integrity, restore drills
- Vault — server-encrypted secrets, key wrap/rotation, export audit
- Audit & change history — immutable change log shared by all add-ons
- Import/export & API layer — versioned read-only API, OpenAPI, scoped write endpoints
- Observability & support — diagnostics, logs, support bundle
- Notification/email — transactional email, domain setup

### 2. Commercial model

**Self-host, one-time purchase.** Perpetual license for the purchased major version, includes first year of quarterly upgrade releases. After year one, an optional maintenance fee restores upgrade + support entitlement. Expired maintenance never disables a running install — it stops delivering new versions. Documented: price anchors per edition, what the license key encodes (edition, modules, seats, issue/expiry, maintenance-through date), signature verification, offline grace window, and how a lapsed key degrades.

**Cloud subscription.** Monthly and yearly (yearly discounted) at defined breakpoints, priced on the OS base plus per add-on, with seat and AI-usage caps per tier. Documented: tier table (Free KB / Homestead / Pro / Contractor), what each cap is, overage behavior, trial and downgrade rules.

**Rails.** Stripe. The doc specifies subscriptions, one-time self-host license purchase, and Connect-based revenue share for electricians, plus the webhook→entitlement mapping (`app_entitlements` rows written by billing rather than by an admin) and what stays provider-agnostic behind a billing port.

**Free tier.** Knowledge Base free forever with caps (users, storage, AI runs/month); paid tiers lift caps and unlock add-ons.

### 3. Add-ons as standalone applications

Each add-on can ship as a standalone app carrying only its own scoped data plus the minimum OS services (auth, licensing, vault, backup/restore, export, data quality, audit).

Two license types:

- **Customer edition** — one site per instance. Hand-over target: the customer owns and edits their scoped data, produces exports, and runs backup/restore. No contractor tooling, no spawn rights.
- **Contractor edition** — many customer sites in one instance with per-site isolation, plus the right to spawn a Customer-edition instance for any site and hand it over.

The doc specifies the hand-over package (scoped dataset + attachments + audit history + license grant + integrity manifest), the spawn flow, and how identity/ownership transfers.

**Electrician deployment choices**, as the request describes:

- Electrician self-hosts the Contractor edition (one-time license) and hands out Customer-edition spawns
- Electrician pays for cloud-managed customer accounts (per-site subscription), keeping continuous records
- Customer pays directly and the electrician receives a revenue share via Stripe Connect

### 4. Migration paths

Documented as first-class, bidirectional where safe:

```text
Standalone (customer)  →  Self-host FarmOps OS  →  Cloud subscription
        ↘                        ↕                      ↙
             portable export bundle + license transfer
```

Rules the doc fixes: stable IDs and audit history survive migration unchanged; canonical/design values never get overwritten by as-built values during import; every migration is preview → approve → apply with a reconciliation report; a migration is reversible by restoring the pre-migration bundle.

### 5. Boundaries and non-goals

Stated explicitly so later phases cannot drift: no canonical ODS write-back, no unrestricted database mutation, no collapsing design and as-built locations, no add-on reaching another add-on's data in standalone form, no license mechanism that can silently disable a self-hosted install already in service.

### 6. Gap analysis against today's codebase

A section mapping each designed capability to what already exists (`app_entitlements`, `app_addons`, `ADDON_KEYS`, `requireAddon`, vault, AI metering, data-quality gates, electrical API) versus what is missing (license-key issuance/verification, edition concept, tenant/site scoping, Stripe billing, standalone packaging, spawn/hand-over tooling), with a suggested build order.

## Technical notes

- `docs/PRODUCT_ARCHITECTURE.md` is the source of truth; the in-app page renders the same material so no content is duplicated by hand.
- Diagrams are ASCII fenced as `text`, consistent with the other docs in `docs/`.
- The gap analysis names existing modules by file so the follow-on implementation phase can start from it.
- Nothing in this phase touches entitlements, schema, navigation gates, or billing.
