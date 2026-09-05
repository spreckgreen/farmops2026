// /demo — public landing page listing the anonymously viewable FarmOps
// presentations. No auth loader and no record reads.
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Presentation,
  Zap,
  BookOpen,
  Cpu,
  Calculator,
  MapPin,
  Wrench,
  Boxes,
  Sprout,
  Camera,
  FileText,
} from "lucide-react";
import { ELECTRICAL_DEMO_SLIDES } from "@/lib/electrical-demo-slides";
import { FARMOPS_OS_DEMO_SLIDES } from "@/lib/farmops-os-demo-slides";
import {
  MAINTENANCE_DEMO_SLIDES,
  INVENTORY_DEMO_SLIDES,
  FOOD_DEMO_SLIDES,
  PROCEDURES_DEMO_SLIDES,
  SECURITY_DEMO_SLIDES,
} from "@/lib/module-demo-slides";
import { PROMO_SLIDES } from "@/lib/promo-slides";
import { SLIDES } from "@/lib/deck-slides";

const TITLE = "FarmOps Demos — Web Presentations";
const DESCRIPTION =
  "Browse the FarmOps web presentations: the FarmOps O/S demo plus a feature deck for every module — Electrical, Maintenance, Inventory, Food & Growing, Security and the free Procedures module. No sign-in required.";

export const Route = createFileRoute("/demo/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DemoIndexPage,
});

const DECKS = [
  {
    to: "/demo/farmops_o_s" as const,
    icon: Cpu,
    name: "FarmOps O/S — feature demo",
    pages: FARMOPS_OS_DEMO_SLIDES.length,
    body: "The shared platform layer, the free-forever Procedures knowledge base, property grids, scoped data clearing and restore, plan entitlements, the read API, and every paid module — with links straight to each module's own deck.",
  },
  {
    to: "/demo/electrical" as const,
    icon: Zap,
    name: "Electrical module — feature demo",
    pages: ELECTRICAL_DEMO_SLIDES.length,
    body: "Panelboards, branch circuits, OCPDs, wiring and switching topology, approval-gated field audits, grid documents, API access, and standalone or federated deployment.",
  },
  {
    to: "/demo/maintenance" as const,
    icon: Wrench,
    name: "Maintenance module — feature demo",
    pages: MAINTENANCE_DEMO_SLIDES.length,
    body: "An equipment register, plans built from real service manuals, usage-based forecasting, symptom-led diagnosis and drafted schedules you approve before they land.",
  },
  {
    to: "/demo/inventory" as const,
    icon: Boxes,
    name: "Inventory module — feature demo",
    pages: INVENTORY_DEMO_SLIDES.length,
    body: "Searchable and barcode-friendly stock, reviewable imports with rollback, parts lists with costs, and kits that check out and come back accounted for.",
  },
  {
    to: "/demo/food" as const,
    icon: Sprout,
    name: "Food & Growing module — feature demo",
    pages: FOOD_DEMO_SLIDES.length,
    body: "The household food plan, garden, orchard and livestock registers, seasons and irrigation, preserving runs, storage inventory and what the season was worth.",
  },
  {
    to: "/demo/security" as const,
    icon: Camera,
    name: "Security module — feature demo",
    pages: SECURITY_DEMO_SLIDES.length,
    body: "A camera register with permanent numbers, real online/offline/unknown status, evidence-only coverage, compass placement before a grid exists, and local bridge wiring.",
  },
  {
    to: "/demo/procedures" as const,
    icon: FileText,
    name: "Procedures module — feature demo (free forever)",
    pages: PROCEDURES_DEMO_SLIDES.length,
    body: "The free knowledge base: editable procedure pages, AI-assisted authoring, manual and document ingestion, linked equipment and parts, review and full export.",
  },
  {
    to: "/promo" as const,
    icon: Presentation,
    name: "FarmOps platform overview",
    pages: PROMO_SLIDES.length,
    body: "Why FarmOps: audited records, approval gates, the add-on line-up, and the deployment and licensing shape.",
  },
  {
    to: "/deck" as const,
    icon: BookOpen,
    name: "Homestead operations handbook",
    pages: SLIDES.length,
    body: "A guided tour of daily operations: tasks, inventory and kits, maintenance plans, food storage and backups, illustrated with real screens.",
  },
];

function DemoIndexPage() {
  return (
    <main className="min-h-screen bg-background text-foreground px-6 py-16">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm uppercase tracking-widest text-primary mb-4">FarmOps</p>
        <h1 className="text-4xl font-semibold mb-4">Web presentations</h1>
        <p className="text-muted-foreground mb-12 max-w-2xl">
          These decks run in the browser — arrow keys to move, G for a page grid, P to save a PDF
          handout. Nothing here reads farm records, and no sign-in is required.
        </p>

        <div className="space-y-5">
          {DECKS.map((d) => (
            <Link
              key={d.to}
              to={d.to}
              search={{ slide: 1, view: undefined }}
              className="block rounded-xl border border-border bg-card px-7 py-6 hover:border-primary transition-colors"
            >
              <div className="flex items-center gap-3 mb-3">
                <d.icon className="h-5 w-5 text-primary shrink-0" />
                <h2 className="text-lg font-semibold">{d.name}</h2>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {d.pages} pages
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{d.body}</p>
            </Link>
          ))}

          <Link
            to="/demo/sample_farm"
            className="block rounded-xl border border-border bg-card px-7 py-6 hover:border-primary transition-colors"
          >
            <div className="flex items-center gap-3 mb-3">
              <MapPin className="h-5 w-5 text-primary shrink-0" />
              <h2 className="text-lg font-semibold">Sample farm — live example</h2>
              <span className="ml-auto text-xs text-muted-foreground">interactive</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              An example barn with panels, circuits and equipment you can click through: approved
              design positions, the field positions that replaced them, and the note recorded for
              each one. Demo data only.
            </p>
          </Link>

          <Link
            to="/demo/pricing"
            className="block rounded-xl border border-border bg-card px-7 py-6 hover:border-primary transition-colors"
          >
            <div className="flex items-center gap-3 mb-3">
              <Calculator className="h-5 w-5 text-primary shrink-0" />
              <h2 className="text-lg font-semibold">Pricing calculator</h2>
              <span className="ml-auto text-xs text-muted-foreground">interactive</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Pick hosted or your own hardware, choose the modules you need, set people and sites, and
              compare first-year and ongoing cost across every proposed edition.
            </p>
          </Link>

        </div>
      </div>
    </main>
  );
}
