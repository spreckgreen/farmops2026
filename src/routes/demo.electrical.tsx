// /demo/electrical — public, anonymous-access feature demo for the FarmOps
// Electrical module. Static slide content only: no auth loader, no record reads.
// ?slide=4 keeps a refresh or shared link on the same page, ?view=grid shows all
// pages, ?view=print stacks them for a PDF handout, and the header also offers a
// PowerPoint download.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DeckViewer, parseDeckSearch, type DeckSearch } from "@/components/deck/deck-viewer";
import { ELECTRICAL_DEMO_SLIDES } from "@/lib/electrical-demo-slides";

const TITLE = "FarmOps Electrical — Feature Demo";
const DESCRIPTION =
  "A walkthrough of the FarmOps Electrical module: panelboards, branch circuits, OCPDs, wiring and switching topology, field audits with approval gates, grid documents, API access, and standalone or federated deployment.";

export const Route = createFileRoute("/demo/electrical")({
  validateSearch: (search: Record<string, unknown>): DeckSearch =>
    parseDeckSearch(search, ELECTRICAL_DEMO_SLIDES.length),
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
  component: ElectricalDemoPage,
});

const ELECTRICAL_SLIDE_LINKS = {
  1: {
    heading: "See it in the app",
    links: [
      { to: "/electrical", label: "Electrical", gated: true },
      { to: "/electrical/grid-map", label: "Grid map", gated: true },
    ],
  },
} as const;

function ElectricalDemoPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <DeckViewer
      slides={ELECTRICAL_DEMO_SLIDES}
      deckName="FarmOps Electrical"
      fileBase="FarmOps-Electrical-Feature-Demo"
      search={search}
      slideLinks={ELECTRICAL_SLIDE_LINKS as never}
      onNavigate={(next, replace) => navigate({ search: next, replace })}
    />
  );
}
