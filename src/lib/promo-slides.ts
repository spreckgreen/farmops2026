// Slide content for the FarmOps promotional deck at /promo.
// Derived from the instructional deck at /deck (same 1920x1080 canvas and
// screenshots) but written to sell the platform and the add-ons.
//
// Every price, seat count and edition name below is pulled from
// src/lib/product-architecture.ts, which is DESIGN DATA. Pricing slides are
// labelled as proposed anchors — do not present them as live prices.
import tasks from "@/assets/deck/tasks.png";
import dashboard from "@/assets/deck/dashboard.png";
import maintenanceForecast from "@/assets/deck/maintenance-forecast.png";
import inventory from "@/assets/deck/inventory.png";
import foodStorage from "@/assets/deck/food-storage.png";
import procedures from "@/assets/deck/procedures.png";
import vault from "@/assets/deck/vault.png";
import aiEngines from "@/assets/deck/admin-ai-engines.png";
import selfHost from "@/assets/deck/settings-self-host.png";
import { ADDON_PRODUCTS, EDITIONS } from "@/lib/product-architecture";

export type PromoSlide =
  | { kind: "title"; kicker: string; title: string; subtitle: string; footer: string }
  | { kind: "statement"; kicker: string; title: string; lead: string; bullets: string[]; note?: string }
  | {
      kind: "cards";
      kicker: string;
      title: string;
      cards: { label: string; heading: string; body: string }[];
      note?: string;
    }
  | {
      kind: "shot";
      kicker: string;
      title: string;
      route: string;
      image: string;
      claim: string;
      points: string[];
    }
  | {
      kind: "addons";
      kicker: string;
      title: string;
      items: { name: string; tier: "free" | "paid"; summary: string; status: string }[];
      note: string;
    }
  | {
      kind: "pricing";
      kicker: string;
      title: string;
      rows: { name: string; price: string; seats: string; addons: string }[];
      note: string;
    }
  | { kind: "cta"; kicker: string; title: string; lead: string; actions: string[]; footer: string };

const addonRows = ADDON_PRODUCTS.map((a) => ({
  name: a.name,
  tier: a.tier,
  summary: a.summary,
  status: a.status,
}));

const editionRow = (key: string) => {
  const e = EDITIONS.find((x) => x.key === key)!;
  return { name: e.name, price: e.price, seats: e.seats, addons: e.addons };
};

export const PROMO_SLIDES: PromoSlide[] = [
  {
    kind: "title",
    kicker: "One platform for the whole property",
    title: "FarmOps",
    subtitle:
      "The operations system for homesteads, farms and the contractors who work on them — daily work, equipment, food, electrical infrastructure and the records that prove it.",
    footer: "Free Knowledge Base forever · Paid add-ons · Cloud or self-hosted",
  },
  {
    kind: "statement",
    kicker: "The problem",
    title: "A working property runs on memory",
    lead: "Everything that keeps the place alive is stored in the least reliable place available.",
    bullets: [
      "Service intervals live in your head, so equipment gets fixed after it fails.",
      "Parts are bought twice because nothing tracks what is already on the shelf.",
      "The electrical system is a folder of photos and one hand-drawn sheet.",
      "When the person who knows the property is away, work stops.",
    ],
    note: "FarmOps writes each of these down once, then reuses it forever.",
  },
  {
    kind: "cards",
    kicker: "The platform",
    title: "FarmOps OS — what every edition ships with",
    cards: [
      {
        label: "Records",
        heading: "Audited change history",
        body: "Every write records actor, before and after values. Nothing is silently overwritten and nothing is deleted.",
      },
      {
        label: "Gates",
        heading: "Preview → approve → apply",
        body: "Bulk imports, repairs and reconciliations are previewed first and applied only on explicit approval.",
      },
      {
        label: "Access",
        heading: "Roles and entitlements",
        body: "Per-module grants, invitations, revocation and lockout — enforced server-side, not in the browser.",
      },
      {
        label: "Continuity",
        heading: "Backup, restore, vault",
        body: "Scheduled exports, verified snapshots, restore drills, and a server-encrypted secrets vault.",
      },
      {
        label: "Integration",
        heading: "Versioned read API",
        body: "A documented API with OpenAPI, bearer tokens and version-stamped document output.",
      },
      {
        label: "Choice",
        heading: "Cloud or your own hardware",
        body: "The same application runs hosted or on a machine in your own shop, with health and preflight checks.",
      },
    ],
    note: "The platform is the product. Add-ons decide which parts of the property it manages.",
  },
  {
    kind: "shot",
    kicker: "Daily work",
    title: "The day is planned, not remembered",
    route: "/tasks",
    image: tasks,
    claim: "Chores, projects and recurring work in one board that stamps its own history.",
    points: [
      "Recurring chores restamp themselves when they close.",
      "Projects roll up from weighted elements instead of a guessed percentage.",
      "The daily log becomes the record of what actually happened on the property.",
    ],
  },
  {
    kind: "shot",
    kicker: "Overview",
    title: "One screen for the state of the place",
    route: "/",
    image: dashboard,
    claim: "Open work, upcoming service, low stock and food status without opening five modules.",
    points: [
      "Everything shown is a live record, not a manually updated summary.",
      "Collapsible, persisted sections keep the view yours between sessions.",
      "Drill from any tile straight into the underlying records.",
    ],
  },
  {
    kind: "shot",
    kicker: "Add-on · Maintenance",
    title: "Equipment gets serviced on interval",
    route: "/maintenance/forecast",
    image: maintenanceForecast,
    claim: "Assets, schedules and service records, with forecasting from the intervals you record.",
    points: [
      "Schedules generate from manufacturer intervals imported off the manual.",
      "Forecast view shows what is coming due before it becomes a breakdown.",
      "Every completed service leaves a dated record attached to the asset.",
    ],
  },
  {
    kind: "shot",
    kicker: "Add-on · Inventory",
    title: "You already own the part",
    route: "/inventory",
    image: inventory,
    claim: "Items, components, consumables and kits — with deployments tracked to where they went.",
    points: [
      "Kits let a trailer or a repair box be checked as one unit.",
      "Usage snapshots show consumption instead of a static count.",
      "Imports bring existing spreadsheets in without retyping them.",
    ],
  },
  {
    kind: "shot",
    kicker: "Add-on · Food & Growing",
    title: "Grow it, preserve it, know what's left",
    route: "/food/storage",
    image: foodStorage,
    claim: "Plantings, harvests, seasons, preservation and stored-food planning in one chain.",
    points: [
      "Harvest records feed preservation and storage instead of ending in a notebook.",
      "Food plan works from stored quantities, so the gap is visible before winter.",
      "Irrigation and season data stay attached to the beds they belong to.",
    ],
  },
  {
    kind: "cards",
    kicker: "Add-on · Electrical Infrastructure",
    title: "The electrical system becomes a record",
    cards: [
      {
        label: "Topology",
        heading: "Panels, feeders, raceways, loads",
        body: "Breaker positions, circuits and devices as related records — with gaps reported as NOT IN RECORD rather than guessed.",
      },
      {
        label: "Field",
        heading: "Grid map and labels",
        body: "Loads plotted on frozen building geometry, plus Avery label sheets ordered for the way you actually walk the building.",
      },
      {
        label: "Trust",
        heading: "Data quality workspace",
        body: "Design versus as-built kept separate, reconciliation against the authorised source, per-record approval before any write.",
      },
      {
        label: "Output",
        heading: "Version-stamped documents",
        body: "Sheets, labels and maps export as PDFs carrying a content digest, so everyone can verify which version of the truth they hold.",
      },
    ],
    note: "This is the add-on a contractor can sell, deliver and hand over.",
  },
  {
    kind: "shot",
    kicker: "Add-on · Knowledge Base",
    title: "Free forever — procedures and manuals",
    route: "/procedures",
    image: procedures,
    claim: "Write a procedure once and anyone on the property can do the job the same way.",
    points: [
      "Ingest manuals and turn them into steps, not a PDF pile.",
      "Procedures link to the assets, kits and tasks they belong to.",
      "Ships enabled on every account, including the free edition.",
    ],
  },
  {
    kind: "shot",
    kicker: "Platform · AI",
    title: "AI that shows the bill first",
    route: "/admin/ai-engines",
    image: aiEngines,
    claim: "Choose an engine per feature, meter every run, and see estimated cost before a paid call.",
    points: [
      "Free self-hosted engine, paid cloud escalation, or cancel — the choice is explicit.",
      "Per-feature toggles and per-user caps are administered, not hidden.",
      "AI proposes; the approval gates still decide what gets written.",
    ],
  },
  {
    kind: "shot",
    kicker: "Platform · Trust",
    title: "Secrets and continuity handled",
    route: "/vault",
    image: vault,
    claim: "A server-encrypted vault for personal and shared secrets, with rotation and export audit.",
    points: [
      "Key wrapping and rotation are first-class, not a text file on a laptop.",
      "Every export is audited with actor and time.",
      "Backups are verified and restore is drilled, not assumed.",
    ],
  },
  {
    kind: "shot",
    kicker: "Platform · Deployment",
    title: "Hosted, or entirely yours",
    route: "/settings/self-host",
    image: selfHost,
    claim: "The same build runs in the cloud or on your own hardware with no feature fork.",
    points: [
      "Containerised install, preflight checks, health and readiness endpoints.",
      "Self-hosted AI engine means no per-run cloud spend.",
      "A lapsed maintenance year stops upgrades — never the install.",
    ],
  },
  {
    kind: "addons",
    kicker: "Product line",
    title: "One free add-on, four paid ones",
    items: addonRows,
    note: "Every add-on can also be sold standalone on top of the same platform shell.",
  },
  {
    kind: "cards",
    kicker: "For electricians and contractors",
    title: "Deliver the record, not just the work",
    cards: [
      {
        label: "Multi-site",
        heading: "Every customer isolated",
        body: "Run one contractor install covering unlimited customer sites, each with its own records and access.",
      },
      {
        label: "Hand-over",
        heading: "Spawn a Customer instance",
        body: "Finish a job and hand the customer their own scoped install — their data, their backups, no contractor tooling.",
      },
      {
        label: "Billing",
        heading: "Stripe, per managed site",
        body: "Contractor subscription plus a per-site fee, with revenue share available when the customer pays directly.",
      },
    ],
    note: "As-built documentation stops being a favour and becomes a billable deliverable.",
  },
  {
    kind: "pricing",
    kicker: "Proposed pricing anchors — design, not live prices",
    title: "How it is licensed",
    rows: [
      editionRow("free_kb"),
      editionRow("cloud_homestead"),
      editionRow("cloud_pro"),
      editionRow("cloud_contractor"),
      editionRow("selfhost_standard"),
      editionRow("selfhost_contractor"),
    ],
    note: "Billing runs on Stripe. Self-host is perpetual: the install keeps working after maintenance lapses.",
  },
  {
    kind: "statement",
    kicker: "Why FarmOps wins",
    title: "Built on a working property, not a whiteboard",
    lead: "The features in this deck exist because the farm they were written for needed them.",
    bullets: [
      "Every screen shown here is a real screen from a running install.",
      "Authority is explicit: canonical source, as-built observation, and approvals in between.",
      "Nothing is inferred — missing data is reported as missing, never invented.",
      "Records outlive the tool: versioned exports, documented API, open PDFs.",
    ],
    note: "Start free on the Knowledge Base and add only the modules the property needs.",
  },
  {
    kind: "cta",
    kicker: "Next step",
    title: "Start with the free Knowledge Base",
    lead: "No card, no expiry. Add Electrical, Maintenance, Inventory or Food when you are ready.",
    actions: [
      "Create a free account and write your first procedure today.",
      "Book a walkthrough of the Electrical add-on and its hand-over package.",
      "Contractors: ask about multi-site licensing and revenue share.",
    ],
    footer: "farmops.bostead.life",
  },
];

/** Short label used for grid view and the tab title. */
export function promoSlideTitle(slide: PromoSlide): string {
  return slide.title;
}
