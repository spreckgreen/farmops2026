// Structured product/commercial architecture for FarmOps as a sellable product.
//
// This module is DESIGN DATA ONLY. Nothing here gates access, prices a real
// transaction, or issues a license — it exists so docs/PRODUCT_ARCHITECTURE.md
// and the in-app page at /docs/product-architecture render the same material
// and cannot drift apart.

export const PRODUCT_ARCH_VERSION = "1.0";

/** Layer 1: FarmOps OS — the platform every edition ships with. */
export interface OsModule {
  key: string;
  name: string;
  purpose: string;
  administeredBy: "owner" | "admin" | "operator" | "vendor";
  gates: string;
  /** What already exists in this codebase, if anything. */
  today: string;
}

export const OS_MODULES: OsModule[] = [
  {
    key: "licensing",
    name: "Licensing & entitlement service",
    purpose:
      "Resolve which edition, add-ons, seats and support window an install is entitled to, online or offline.",
    administeredBy: "vendor",
    gates: "Every add-on route, every metered AI feature, seat creation, upgrade delivery.",
    today:
      "app_entitlements + app_addons + requireAddon() cover per-user module grants; there is no edition, license key or seat concept yet.",
  },
  {
    key: "ai",
    name: "AI configuration, routing & billing",
    purpose:
      "Choose engines per feature area, meter runs, price cloud usage, cap spend and show cost before a paid run.",
    administeredBy: "admin",
    gates: "Cloud escalation offers, per-feature toggles, per-user usage caps.",
    today:
      "Built: ai-routing, ai-engines, ai-metering.server, ai-usage, ai-pricing, ai-feature-toggles, escalation offers.",
  },
  {
    key: "users",
    name: "User management",
    purpose: "Roles, invitations, per-module grants, revocation and abuse lockout.",
    administeredBy: "admin",
    gates: "All RLS policies via user_roles; add-on grants via entitlements.",
    today:
      "Built: user_roles + has_role(), app_entitlements admin UI, revocation counter and one-year lockout.",
  },
  {
    key: "config",
    name: "Configuration management",
    purpose:
      "Environment and tenant settings, feature toggles, versioned config with an audit trail.",
    administeredBy: "admin",
    gates: "Feature visibility, integration endpoints, timezone/units, self-host mode.",
    today: "Partial: config.server, self-host.functions, ai_feature_toggles. No versioned config history.",
  },
  {
    key: "deploy",
    name: "Deployment & installation management",
    purpose:
      "Installers, upgrade channel, migration state, preflight and health/readiness checks.",
    administeredBy: "operator",
    gates: "Upgrade download (maintenance window), destructive migrations.",
    today:
      "Built: Dockerfile, docker-compose, bootstrap-selfhost.sh, host-preflight, healthcheck, /api/public/health and /ready.",
  },
  {
    key: "dq",
    name: "Data quality management",
    purpose:
      "Reconciliation framework with an explicit authority model (design vs as-built) and preview → approve → apply gates.",
    administeredBy: "admin",
    gates: "Every bulk write, every import, every repair.",
    today:
      "Built for Electrical: grid data quality workspace, contract v3 reconciliation, mapping repair, apply gates, change audit.",
  },
  {
    key: "backup",
    name: "Backup, restore & disaster recovery",
    purpose: "Scheduled exports, snapshot integrity verification, restore drills.",
    administeredBy: "operator",
    gates: "Restore (destructive), key export.",
    today: "Built: vault-backup.sh, restore-snapshot.mjs, snapshot integrity tests, DISASTER_RECOVERY.md.",
  },
  {
    key: "vault",
    name: "Vault",
    purpose: "Server-encrypted personal and shared secrets, key wrapping, rotation, export audit.",
    administeredBy: "owner",
    gates: "Secret read/write, key export, rotation.",
    today: "Built: vault_secrets, vault_key_wrap_credentials, vault_key_export_audit, /vault, /admin/vault-rotation.",
  },
  {
    key: "audit",
    name: "Audit & change history",
    purpose: "One immutable change log every module writes to, with before/after values and actor.",
    administeredBy: "admin",
    gates: "Nothing — it records, it never blocks. Deletion is not offered.",
    today: "Built for Electrical: electrical_change_audit + recordElectricalChange. Not yet generalised.",
  },
  {
    key: "api",
    name: "Import/export & API layer",
    purpose: "Versioned read-only API plus narrowly scoped write endpoints, with OpenAPI.",
    administeredBy: "admin",
    gates: "Bearer token + add-on entitlement; apply endpoints need explicit approval.",
    today: "Built for Electrical: /api/electrical/v1, OpenAPI spec, docs/ELECTRICAL_API.md.",
  },
  {
    key: "observability",
    name: "Observability & support",
    purpose: "Diagnostics, log capture, support bundles for a self-hosted operator.",
    administeredBy: "operator",
    gates: "Log access (admin only), support bundle export.",
    today: "Built: diag-logs, collect-logs.sh, diagnose.sh, /admin diagnostics.",
  },
  {
    key: "email",
    name: "Notification & email",
    purpose: "Transactional email, auth templates, sending-domain setup.",
    administeredBy: "admin",
    gates: "Outbound send, template edits.",
    today: "Partial: app-email.functions. No per-tenant sending domain.",
  },
];

/** Layer 2: add-ons. */
export interface AddonProduct {
  key: string;
  name: string;
  tier: "free" | "paid";
  summary: string;
  standalone: boolean;
  status: "shipping" | "in-app today" | "planned";
}

export const ADDON_PRODUCTS: AddonProduct[] = [
  {
    key: "knowledge_base",
    name: "Knowledge Base",
    tier: "free",
    summary:
      "Procedures, manuals, ingest and search. Ships enabled by default so a new account has something useful on day one and learns the OS shell.",
    standalone: true,
    status: "in-app today",
  },
  {
    key: "electrical",
    name: "Electrical Infrastructure",
    tier: "paid",
    summary:
      "Panels, feeders, raceways, loads, breaker positions, grid maps, labels, QA, reconciliation, field observations, versioned API.",
    standalone: true,
    status: "shipping",
  },
  {
    key: "food",
    name: "Food & Growing",
    tier: "paid",
    summary: "Crops, plantings, harvests, seasons, preservation, food plan and storage, irrigation.",
    standalone: true,
    status: "in-app today",
  },
  {
    key: "cameras",
    name: "Cameras",
    tier: "paid",
    summary:
      "Camera register with live feeds, recorded plan positions and facing, coverage wedges on the building plan, and on-demand reachability checks with history.",
    standalone: true,
    status: "in-app today",
  },
  {
    key: "inventory",
    name: "Inventory",
    tier: "paid",
    summary: "Items, components, kits and deployments, consumables, imports, usage snapshots.",
    standalone: true,
    status: "in-app today",
  },
  {
    key: "maintenance",
    name: "Maintenance",
    tier: "paid",
    summary: "Assets, schedules, records, symptom diagnosis and failure forecasting.",
    standalone: true,
    status: "in-app today",
  },
];

/** Layer 3: how a given install is licensed. */
export type EditionKey =
  | "free_kb"
  | "cloud_homestead"
  | "cloud_pro"
  | "cloud_contractor"
  | "selfhost_standard"
  | "selfhost_contractor"
  | "standalone_customer";

export interface Edition {
  key: EditionKey;
  name: string;
  model: "free" | "subscription" | "perpetual";
  price: string;
  seats: string;
  sites: string;
  addons: string;
  aiPolicy: string;
  notes: string;
}

/** Price anchors are design proposals, not live prices. */
export const EDITIONS: Edition[] = [
  {
    key: "free_kb",
    name: "Free — Knowledge Base",
    model: "free",
    price: "$0 forever",
    seats: "2",
    sites: "1",
    addons: "Knowledge Base only",
    aiPolicy: "25 cloud AI runs/month, or unlimited self-hosted engine",
    notes: "Caps: 1 GB attachments, no API tokens, community support. Never expires.",
  },
  {
    key: "cloud_homestead",
    name: "Cloud — Homestead",
    model: "subscription",
    price: "$19/mo or $190/yr",
    seats: "5",
    sites: "1",
    addons: "KB + any 1 paid add-on",
    aiPolicy: "500 cloud runs/mo, metered overage at published token cost + 20%",
    notes: "10 GB attachments, email support, daily backups retained 30 days.",
  },
  {
    key: "cloud_pro",
    name: "Cloud — Pro",
    model: "subscription",
    price: "$49/mo or $490/yr",
    seats: "15",
    sites: "3",
    addons: "KB + all paid add-ons",
    aiPolicy: "2,500 cloud runs/mo, bring-your-own key allowed",
    notes: "100 GB attachments, API tokens, reconciliation tooling, 90-day backup retention.",
  },
  {
    key: "cloud_contractor",
    name: "Cloud — Contractor",
    model: "subscription",
    price: "$99/mo base + $9/mo per managed customer site",
    seats: "25 staff",
    sites: "Unlimited, billed per site",
    addons: "Electrical (multi-site) + all add-ons on the contractor's own site",
    aiPolicy: "5,000 cloud runs/mo pooled across sites",
    notes:
      "Spawn rights: may issue a Customer-edition instance per site. Revenue share available when the customer pays directly.",
  },
  {
    key: "selfhost_standard",
    name: "Self-host — Standard",
    model: "perpetual",
    price: "$899 one-time, includes 12 months of quarterly upgrades",
    seats: "Unlimited on one install",
    sites: "1",
    addons: "KB + purchased add-ons (each add-on licensed separately)",
    aiPolicy: "Self-hosted engine unlimited; cloud AI needs the operator's own provider key",
    notes: "After 12 months: $199/yr maintenance restores upgrades + support. Lapsing never stops the install.",
  },
  {
    key: "selfhost_contractor",
    name: "Self-host — Contractor",
    model: "perpetual",
    price: "$1,899 one-time, includes 12 months of quarterly upgrades",
    seats: "Unlimited staff",
    sites: "Unlimited customer sites, isolated",
    addons: "Electrical multi-site + spawn rights",
    aiPolicy: "Self-hosted engine unlimited; cloud AI via the contractor's own key",
    notes: "After 12 months: $349/yr maintenance. Spawned Customer instances carry their own license grant.",
  },
  {
    key: "standalone_customer",
    name: "Standalone — Customer",
    model: "perpetual",
    price: "$0 when spawned under a Contractor license; $249 one-time standalone",
    seats: "3",
    sites: "1",
    addons: "Exactly one add-on's scoped data",
    aiPolicy: "No cloud AI by default; self-hosted engine optional",
    notes:
      "Hand-over target. Customer may edit their scoped data, export, back up and restore. No contractor tooling, no spawn rights.",
  },
];

/** What a self-host license key asserts. Signature-verified, offline-checkable. */
export const LICENSE_CLAIMS = [
  "license_id — stable, printed on the invoice",
  "edition — one of the perpetual or standalone editions",
  "modules — the licensed add-on keys",
  "seats — maximum concurrent named users (0 = unlimited)",
  "sites — maximum isolated customer sites",
  "issued_at / version_ceiling — the major version this perpetual grant covers",
  "maintenance_through — last date upgrades and support are entitled",
  "spawn_rights — may this install issue Customer-edition grants",
  "signature — vendor Ed25519 signature over the claim set",
];

export const LICENSE_RULES = [
  "Verification is offline: the public key ships with the binary, so an air-gapped farm never phones home.",
  "A lapsed maintenance_through date stops upgrade delivery and vendor support. It NEVER disables a running install, locks data, or degrades features already in service.",
  "An expired cloud subscription drops to read-only + export for 60 days before data is archived; export is never blocked.",
  "Seat and site ceilings block creating the next one; they never evict an existing one.",
  "Clock tampering is tolerated with a 30-day grace band rather than a hard fail, so a wrong RTC never bricks a shop install.",
  "Every license decision is written to the audit log with the claim set that produced it.",
];

export interface BillingFlow {
  name: string;
  trigger: string;
  effect: string;
}

export const BILLING_FLOWS: BillingFlow[] = [
  {
    name: "Cloud subscription created",
    trigger: "Stripe checkout.session.completed / customer.subscription.created",
    effect:
      "Write app_entitlements rows for the tier's add-on keys with status active and expires_at = current_period_end.",
  },
  {
    name: "Renewal",
    trigger: "invoice.paid",
    effect: "Extend expires_at. No user-visible action.",
  },
  {
    name: "Payment failure",
    trigger: "invoice.payment_failed after retries",
    effect: "Status → expired. UI becomes read-only + export. Nothing is deleted.",
  },
  {
    name: "Self-host purchase",
    trigger: "One-time checkout for a perpetual edition",
    effect: "Issue and email a signed license key; record it against the buyer for reissue.",
  },
  {
    name: "Maintenance renewal",
    trigger: "Annual maintenance invoice paid",
    effect: "Reissue the key with a new maintenance_through date; upgrade channel reopens.",
  },
  {
    name: "Per-site contractor billing",
    trigger: "Contractor adds a managed customer site",
    effect: "Add a metered subscription item; removing the site stops billing at period end.",
  },
  {
    name: "Revenue share",
    trigger: "Customer pays directly for a site the electrician introduced",
    effect:
      "Stripe Connect transfer of the agreed share (design anchor: 20% of net for as long as the electrician remains the site's service provider).",
  },
];

export const BILLING_PORT_NOTES = [
  "One billing port interface (createCheckout, resolveEntitlements, onProviderEvent) keeps Stripe replaceable.",
  "Entitlements remain the single source of truth the app reads; billing only writes them.",
  "Self-host installs never call the billing port — they resolve entitlements from the license key.",
];

export interface HandoverStep {
  step: string;
  detail: string;
}

export const HANDOVER_PACKAGE = [
  "Scoped dataset for exactly one site, stable IDs unchanged",
  "Attachments and nameplate photos with checksums",
  "Full change/audit history for those records",
  "Canonical design values and as-built values kept in separate fields",
  "A Customer-edition license grant, or an activation code for one",
  "Integrity manifest (row counts per table, SHA-256 of the bundle)",
  "A human-readable hand-over report listing unresolved and field-confirmation-required records",
];

export const HANDOVER_FLOW: HandoverStep[] = [
  { step: "1. Select site", detail: "Contractor picks one customer site in a multi-site install." },
  {
    step: "2. Preview",
    detail:
      "Bundle is built read-only; the report shows row counts, unresolved records and anything withheld.",
  },
  { step: "3. Approve", detail: "Contractor confirms scope; the approval is audited." },
  {
    step: "4. Spawn",
    detail:
      "Cloud: a Customer-edition tenant is provisioned and the bundle imported. Self-host: a signed bundle + activation code is handed over for the customer's own install.",
  },
  {
    step: "5. Transfer ownership",
    detail:
      "The customer's account becomes owner. The contractor's continued access is an explicit, revocable grant — not implicit.",
  },
  {
    step: "6. Reconcile",
    detail:
      "Both sides run the integrity manifest check; mismatches block completion rather than being warned past.",
  },
];

export const ELECTRICIAN_MODELS = [
  {
    name: "Self-hosted contractor",
    detail:
      "One-time Self-host Contractor license. The electrician keeps every customer's record on their own box and hands out spawned Customer instances at project close.",
    revenue: "License + annual maintenance.",
  },
  {
    name: "Cloud-managed customer accounts",
    detail:
      "The electrician pays the per-site cloud fee to keep continuous records for customers under ongoing service agreements.",
    revenue: "Base subscription + per-site metered fee.",
  },
  {
    name: "Customer-paid with revenue share",
    detail:
      "The customer subscribes directly for their own site; the electrician stays attached as service provider and receives a share.",
    revenue: "Customer subscription, minus the electrician's Connect payout.",
  },
];

export const MIGRATION_RULES = [
  "Stable IDs (PNL-*, CON-###, EMT-###, JB-###-##, BR-###-##-##, FS-###) survive every migration unchanged.",
  "Audit history migrates with the records; it is never truncated to fit a target schema.",
  "Canonical/design values are never overwritten by as-built values during import, and vice versa.",
  "Newer field evidence is never overwritten by an older bundle.",
  "Every migration is preview → approve → apply with a reconciliation report per record.",
  "A migration is reversible by restoring the pre-migration bundle; the bundle is retained for 90 days.",
  "Unresolved, interval and mobile/non-fixed locations stay unresolved — migration never invents coordinates.",
];

export const NON_GOALS = [
  "No canonical ODS write-back from any edition.",
  "No unrestricted database mutation endpoint, in any edition or API version.",
  "No collapsing design, provisional and verified as-built locations into one field.",
  "No add-on reading another add-on's data in a standalone build.",
  "No license mechanism that can silently disable or degrade a self-hosted install already in service.",
  "No telemetry phone-home requirement for self-host license validation.",
  "No seat/site enforcement that deletes or evicts existing records or users.",
];

export interface GapItem {
  capability: string;
  exists: string;
  missing: string;
  phase: 1 | 2 | 3 | 4;
}

export const GAP_ANALYSIS: GapItem[] = [
  {
    capability: "Edition concept",
    exists: "Per-user add-on keys in src/lib/addons.ts (ADDON_KEYS) and app_entitlements rows.",
    missing: "An edition/plan record that bundles add-ons, seats, sites and caps; resolution order edition → add-on → user grant.",
    phase: 1,
  },
  {
    capability: "License key issuance & verification",
    exists: "Nothing. Grants are admin-written entitlement rows.",
    missing: "Signed claim set, Ed25519 verify at boot, offline grace band, reissue on maintenance renewal.",
    phase: 1,
  },
  {
    capability: "Tenant / site scoping",
    exists: "Single-farm assumption; RLS scopes by auth.uid() and roles.",
    missing: "A site_id on scoped tables plus RLS by site membership — the prerequisite for Contractor multi-site.",
    phase: 2,
  },
  {
    capability: "Stripe billing",
    exists: "AI cost metering and a usage bill view (ai-metering.server, ai-usage-bill.tsx) — internal only.",
    missing: "Checkout, subscription webhooks writing entitlements, one-time license purchase, Connect payouts.",
    phase: 2,
  },
  {
    capability: "Usage caps & overage",
    exists: "Per-run pricing and usage events (ai_usage_events, ai-pricing.ts).",
    missing: "Cap enforcement per tier, overage authorisation, cap-reached UX.",
    phase: 2,
  },
  {
    capability: "Generalised audit log",
    exists: "electrical_change_audit + recordElectricalChange, plus activity_log.",
    missing: "One module-agnostic change log the other add-ons write to with the same before/after contract.",
    phase: 3,
  },
  {
    capability: "Standalone packaging",
    exists: "Docker image, compose file, bootstrap script, add-on route gating.",
    missing: "Per-add-on build target that omits other modules, and a standalone shell with only the minimum OS services.",
    phase: 3,
  },
  {
    capability: "Spawn / hand-over tooling",
    exists: "Snapshot export, restore-snapshot.mjs, integrity tests, electrical API document bundle.",
    missing: "Site-scoped bundle builder, integrity manifest, activation codes, ownership transfer, hand-over report.",
    phase: 4,
  },
  {
    capability: "Migration between models",
    exists: "Preview→approve→apply gates and reconciliation patterns proven in the Electrical module.",
    missing: "A generic bundle importer that applies the migration rules across add-ons.",
    phase: 4,
  },
];

export const BUILD_ORDER = [
  "Phase 1 — Licensing core: edition records, license claim set, verification, entitlement resolution order. No pricing yet.",
  "Phase 2 — Commerce: Stripe checkout and webhooks, tier caps and overage, per-site metering, Connect payouts.",
  "Phase 3 — Modularisation: generalised audit log, per-add-on build targets, standalone shell, site scoping enforced in RLS.",
  "Phase 4 — Portability: site-scoped bundles, spawn and hand-over, migration importer both directions.",
];
