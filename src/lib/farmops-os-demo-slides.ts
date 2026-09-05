// Slide content for the public FarmOps O/S demo at /demo/farmops_o_s.
//
// Text-only layouts (no screenshots, no farm records) so the deck can be shown
// anonymously. Module status and price anchors are read from
// src/lib/product-architecture.ts, which is DESIGN DATA — pricing slides are
// labelled as proposed anchors, not live prices.
import { type PromoSlide } from "@/lib/promo-slides";
import { ADDON_PRODUCTS, EDITIONS } from "@/lib/product-architecture";

const addonItems = ADDON_PRODUCTS.map((a) => ({
  name: a.name,
  tier: a.tier,
  summary: a.summary,
  status: a.status,
}));

const pricingRows = EDITIONS.filter((e) =>
  ["free_kb", "cloud_homestead", "cloud_pro", "selfhost_standard"].includes(e.key),
).map((e) => ({
  name: e.name,
  price: e.price,
  seats: e.seats,
  addons: e.addons,
}));

export const FARMOPS_OS_DEMO_SLIDES: PromoSlide[] = [
  {
    kind: "title",
    kicker: "FarmOps O/S · Feature demo",
    title: "The operations layer under every module",
    subtitle:
      "FarmOps O/S is the shared platform: identity and roles, entitlements, configuration, data quality gates, audit history, vault, backups, API and AI routing. Modules plug into it — starting with a Procedures knowledge base that is free forever.",
    footer: "Feature demo · design data, no live farm records · a deck for every module",
  },
  {
    kind: "statement",
    kicker: "What it is",
    title: "One platform, then modules on top",
    lead:
      "Everything a working property needs before it records a single asset already exists as the O/S layer. Modules are the domain knowledge that sits on it.",
    bullets: [
      "Sign in, roles and per-module grants are platform concerns — not something each module reinvents.",
      "Preview, approve, apply is a platform pattern, so every module inherits the same write discipline.",
      "Audit history, exports, backups and disaster recovery apply to whatever module is enabled.",
      "AI engine choice, metering and cost estimates are configured once and used by every feature area.",
    ],
    note:
      "A subscription does not buy the platform. It unlocks modules on a platform you already have.",
  },
  {
    kind: "cards",
    kicker: "Platform · people and permission",
    title: "Who can do what, proven server-side",
    cards: [
      {
        label: "Built",
        heading: "User management",
        body: "Roles in their own table with server-side checks, invitations, per-module grants, revocation and abuse lockout.",
      },
      {
        label: "Built",
        heading: "Entitlements",
        body: "Per-user module grants already gate every module route. Editions, license keys and seat ceilings are the packaging work that remains.",
      },
      {
        label: "Built",
        heading: "Vault",
        body: "Server-encrypted personal and shared secrets with key wrapping, rotation and export auditing.",
      },
      {
        label: "Partial",
        heading: "Configuration",
        body: "Environment, self-host mode, timezone and feature toggles are in place; versioned configuration history is still to come.",
      },
    ],
  },
  {
    kind: "cards",
    kicker: "Platform · trust and continuity",
    title: "The parts nobody notices until they matter",
    cards: [
      {
        label: "Built",
        heading: "Data quality gates",
        body: "Reconciliation with an explicit authority model — design versus as-built — and preview, approve, apply on every bulk write, import and repair.",
      },
      {
        label: "Built",
        heading: "Audit and change history",
        body: "Before and after values with the actor and the evidence. It records; it never blocks, and deletion is not offered.",
      },
      {
        label: "Built",
        heading: "Backup and recovery",
        body: "Scheduled exports, snapshot integrity verification, restore tooling and a written disaster-recovery procedure.",
      },
      {
        label: "Built",
        heading: "Deploy and observe",
        body: "Container deployment, scripted bootstrap, host preflight, health and readiness endpoints, log capture and diagnostics.",
      },
    ],
    note: "Each of these is generalised from the Electrical module's proven implementation.",
  },
  {
    kind: "statement",
    kicker: "Free forever",
    title: "Procedures: the free module",
    lead:
      "Every account starts with the Procedures knowledge base enabled. It is genuinely useful on its own and teaches the O/S shell at the same time.",
    bullets: [
      "Write procedures and service instructions once, then find them by search when you need them in the barn.",
      "Ingest existing manuals and exported documents into structured, searchable articles.",
      "Attach references, cross-link related procedures and keep revision history.",
      "Runs standalone: no paid module is required, and it never expires.",
    ],
    note: "Free tier caps are about volume and support — not about crippling the feature.",
  },
  {
    kind: "statement",
    kicker: "The work ahead",
    title: "The modules are built. Packaging is what is left.",
    lead:
      "These are not concepts waiting to be developed. They run today inside FarmOps and need to become separately licensable products.",
    bullets: [
      "Give each module a licensed identity, so an install can be entitled to some modules and not others.",
      "Add edition, seat and site ceilings on top of the existing per-user grants.",
      "Offline-verifiable license claims for self-hosted installs, so an air-gapped farm never phones home.",
      "Subscription lifecycle: upgrade, downgrade, lapse and export — with data access never held hostage.",
    ],
    note:
      "Ceilings block creating the next seat or site. They never evict an existing one, and never disable a running install.",
  },
  {
    kind: "addons",
    kicker: "Line-up",
    title: "Modules available on the platform",
    items: addonItems,
    note:
      "Free forever means the Procedures knowledge base. Paid modules are already in the application; the label shows how finished each one is.",
  },
  {
    kind: "cards",
    kicker: "Module · Electrical Infrastructure",
    title: "The most complete module today",
    cards: [
      {
        label: "Model",
        heading: "Distribution end to end",
        body: "Service equipment, feeders, panelboards, OCPD positions, circuit groups, wiring runs, switching and loads with permanent identifiers.",
      },
      {
        label: "Field",
        heading: "Audits with approval gates",
        body: "One observation stages every consequence atomically; unproven facts stay explicit holds and applied batches are immutable.",
      },
      {
        label: "Output",
        heading: "Maps, labels, documents",
        body: "Coordinate-native building plan, grid maps, walk-ordered QR labels, printable grid documents and panel completeness reporting.",
      },
      {
        label: "Integrate",
        heading: "Versioned API",
        body: "Scoped, bearer-authenticated read API with an OpenAPI specification, plus preview-only instance-to-instance sync.",
      },
    ],
    note: "Status: shipping. This module also stands alone for an electrician or a single property.",
  },
  {
    kind: "cards",
    kicker: "Module · Maintenance",
    title: "Keeping equipment alive",
    cards: [
      {
        label: "Assets",
        heading: "Equipment register",
        body: "Assets with their service history, manuals and the procedures that apply to them.",
      },
      {
        label: "Plan",
        heading: "Schedules generated, not typed",
        body: "Service schedules derived from usage and interval rules, so the next due date follows the machine, not a sticky note.",
      },
      {
        label: "Diagnose",
        heading: "Symptoms to causes",
        body: "Symptom-led diagnosis backed by imported service manuals and recorded history.",
      },
      {
        label: "Forecast",
        heading: "What will break next",
        body: "Failure forecasting and a forward view of upcoming work, so parts are ordered before the breakdown.",
      },
    ],
    note: "Status: in the application today; needs module packaging only.",
  },
  {
    kind: "cards",
    kicker: "Module · Inventory",
    title: "Parts, kits and where they went",
    cards: [
      {
        label: "Items",
        heading: "Items and components",
        body: "Stock with types, locations, quantities and the parts that make up an assembly.",
      },
      {
        label: "Kits",
        heading: "Kits and deployments",
        body: "Build a kit once, then track where each deployed copy lives and what it currently contains.",
      },
      {
        label: "Flow",
        heading: "Consumables and usage",
        body: "Consumption recorded against work, with usage snapshots that show real burn rate instead of a guess.",
      },
      {
        label: "Load",
        heading: "Validated imports",
        body: "Spreadsheet imports validated before they land, with the same preview-and-approve discipline as everything else.",
      },
    ],
    note: "Status: in the application today; needs module packaging only.",
  },
  {
    kind: "cards",
    kicker: "Module · Food & Growing",
    title: "From seed to shelf",
    cards: [
      {
        label: "Grow",
        heading: "Crops and plantings",
        body: "Garden, orchard and livestock records with seasons, planting plans and harvest logging.",
      },
      {
        label: "Water",
        heading: "Irrigation",
        body: "Irrigation zones and schedules tied to the beds and trees they actually serve.",
      },
      {
        label: "Keep",
        heading: "Preservation and storage",
        body: "Processing and preservation runs, plus storage inventory so you know what is on the shelf in February.",
      },
      {
        label: "Judge",
        heading: "Plan and prices",
        body: "A food plan against household need, with price tracking to show what the growing season is worth.",
      },
    ],
    note: "Status: in the application today; needs module packaging only.",
  },
  {
    kind: "cards",
    kicker: "Module · Security",
    title: "Cameras recorded, not sketched",
    cards: [
      {
        label: "Register",
        heading: "Cameras with stable numbers",
        body: "Each camera keeps a permanent number, a playable feed kind where one exists, and a checked status with the time it was checked.",
      },
      {
        label: "Coverage",
        heading: "Evidence-only coverage",
        body: "A coverage cone is drawn only where both a position and an aim were recorded. Everything else is listed as a named gap.",
      },
      {
        label: "Before a grid",
        heading: "Compass placement",
        body: "New buildings place cameras by compass side and slot until a measured grid exists — never by inventing coordinates.",
      },
      {
        label: "Bridges",
        heading: "Brands with no public video",
        body: "A local bridge on your own network republishes such streams in a form a browser can play, with mixed-content problems called out.",
      },
    ],
    note: "Status: in the application today. Cameras can also be given their own electrical records, preview first.",
  },
  {
    kind: "statement",
    kicker: "Platform · property geography",
    title: "Locations that every module can point at",
    lead:
      "Before a module records anything, the property needs places. FarmOps builds those places from what you can actually supply.",
    bullets: [
      "Define a building grid from entered dimensions with a shape template — rectangle, L, T, or rectangle with a lean-to.",
      "Or import the outline: a corner list, an SVG drawing, or a CAD file; or trace the corners on aerial imagery.",
      "Set orientation against north, the walk-around start, finish and pattern, and the cell size per building.",
      "Grid references are derived, human-readable labels — physical coordinates stay the authority underneath.",
    ],
    note: "Existing sites add outbuilding grids the same way a new site defines its first one.",
  },
  {
    kind: "cards",
    kicker: "Platform · data lifecycle",
    title: "Clearing and restoring on purpose",
    cards: [
      {
        label: "Scoped",
        heading: "Site, module or location",
        body: "An administrator can clear a whole site, one module, or one location on a site — the scope is chosen, never implied.",
      },
      {
        label: "Backed up",
        heading: "Backup before every clear",
        body: "Each clear takes a downloadable backup first, and restore only runs into a scope that is empty.",
      },
      {
        label: "Protected",
        heading: "Accounts never touched",
        body: "Accounts, roles, subscriptions and entitlements are excluded from any clear, and rows that cannot be tied to a location are withheld and reported.",
      },
      {
        label: "Shippable",
        heading: "A clean starting image",
        body: "The same capability produces an empty, ready-to-ship install without hand-editing tables.",
      },
    ],
  },
  {
    kind: "statement",
    kicker: "Platform · entitlements",
    title: "You can see exactly what your plan opens",
    lead:
      "Plans are not a marketing page. Signed in, FarmOps lists the real pages each plan opens and marks the ones currently closed to you.",
    bullets: [
      "A plans page per tier, with the modules it covers and the actual screens inside them.",
      "Procedures, the knowledge base and the dashboard are listed as free on every plan.",
      "A trial can be started, and module allowances are counted rather than assumed.",
      "Access is decided by the server on every page — the plan pages only describe it.",
    ],
  },
  {
    kind: "statement",
    kicker: "Platform · connected instances",
    title: "An API, and instances that stay in step",
    lead:
      "Electrical records already publish through a versioned, token-scoped read API with a published specification. Two instances can be kept in step without either one trusting the other.",
    bullets: [
      "Tokens carry explicit scopes and rate limits, and unauthenticated requests fail closed.",
      "Write surfaces exist but stay switched off until they are explicitly activated.",
      "A scheduled one-way pull brings applied field-audit batches from a peer instance in as previews only.",
      "Nothing pulled is ever auto-applied, and nothing is pushed back to the source.",
    ],
  },
  {
    kind: "cards",
    kicker: "Go deeper",
    title: "Every module has its own feature deck",
    cards: [
      {
        label: "/demo/electrical",
        heading: "Electrical",
        body: "Panelboards, branch circuits, wiring and switching topology, approval-gated field audits and grid documents.",
      },
      {
        label: "/demo/maintenance",
        heading: "Maintenance",
        body: "Plans built from real manuals, a usage-based forecast, symptom diagnosis and service scheduling.",
      },
      {
        label: "/demo/inventory",
        heading: "Inventory",
        body: "Searchable register, reviewable imports with rollback, parts lists with costs, and kits that check out and back in.",
      },
      {
        label: "/demo/food · /demo/security · /demo/procedures",
        heading: "Food, Security, Procedures",
        body: "The food plan and growing registers, the camera register and coverage, and the free-forever knowledge base.",
      },
    ],
    note: "Every deck downloads as a PDF or a PowerPoint handout from its own header.",
  },
  {
    kind: "statement",
    kicker: "Upgrade path",
    title: "Growing from free without a migration",
    lead:
      "Because the platform is the same in every edition, enabling a module is a grant — not an import, a new account or a data move.",
    bullets: [
      "Start free with Procedures and learn the shell: search, roles, exports, backups.",
      "Enable one paid module when a real need appears; existing procedures and users stay exactly as they are.",
      "Add more modules over time without changing how the platform behaves.",
      "Every edition keeps full export. Leaving is a supported operation, not a support ticket.",
    ],
  },
  {
    kind: "pricing",
    kicker: "Proposed anchors",
    title: "Editions under discussion",
    rows: pricingRows,
    note:
      "These are design price anchors from the product architecture document, not live prices. Contractor multi-site editions exist in the same model and are covered in the platform overview deck.",
  },
  {
    kind: "statement",
    kicker: "Ownership",
    title: "Hosted or on your own hardware",
    lead:
      "The same build runs in the cloud or in your shop, because self-hosting was designed in rather than bolted on.",
    bullets: [
      "Container deployment with scripted bootstrap, environment preflight and health checks.",
      "Self-hosted AI engine option, so nothing has to leave the property to answer a question.",
      "Offline license verification: the public key ships with the build and an air-gapped install never phones home.",
      "A lapsed maintenance date stops upgrades and support — it never disables a running install or locks your data.",
    ],
    note: "Backups, snapshot verification and restore drills are part of the product in every edition.",
  },
  {
    kind: "cta",
    kicker: "Next step",
    title: "Start free, add what you need",
    lead:
      "Take the free Procedures module first, then turn on the module that matches the problem currently costing you the most time.",
    actions: [
      "Open the free Procedures knowledge base and load one real manual.",
      "Pick the module closest to today's pain: electrical records, maintenance, inventory or food.",
      "Decide hosted or self-hosted — the platform and your data model are identical either way.",
      "Ask about the Electrical module's standalone and contractor multi-site direction.",
    ],
    footer: "farmops.bostead.life/demo/farmops_o_s",
  },
];
