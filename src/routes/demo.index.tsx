// /demo — public landing page listing the anonymously viewable FarmOps
// presentations. No auth loader and no record reads.
import { createFileRoute, Link } from "@tanstack/react-router";
import { Presentation, Zap, BookOpen, Cpu } from "lucide-react";
import { ELECTRICAL_DEMO_SLIDES } from "@/lib/electrical-demo-slides";
import { FARMOPS_OS_DEMO_SLIDES } from "@/lib/farmops-os-demo-slides";
import { PROMO_SLIDES } from "@/lib/promo-slides";
import { SLIDES } from "@/lib/deck-slides";

const TITLE = "FarmOps Demos — Web Presentations";
const DESCRIPTION =
  "Browse the FarmOps web presentations: the FarmOps O/S demo, the Electrical module feature demo, the platform overview, and the homestead operations handbook. No sign-in required.";

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
    body: "The shared platform layer, the free-forever Procedures knowledge base, and the Electrical, Maintenance, Inventory and Food modules already built and awaiting subscription packaging. Downloadable as a PDF.",
  },
  {
    to: "/demo/electrical" as const,
    icon: Zap,
    name: "Electrical module — feature demo",
    pages: ELECTRICAL_DEMO_SLIDES.length,
    body: "Panelboards, branch circuits, OCPDs, wiring and switching topology, approval-gated field audits, grid documents, API access, and standalone or federated deployment.",
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
        </div>
      </div>
    </main>
  );
}
