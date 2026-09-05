// /demo/maintenance — public, anonymous feature demo for the Maintenance module.
// Static slide content only; no auth loader and no record reads.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DeckViewer, parseDeckSearch, type DeckSearch } from "@/components/deck/deck-viewer";
import { MAINTENANCE_DEMO_SLIDES, MAINTENANCE_SLIDE_LINKS } from "@/lib/module-demo-slides";

const TITLE = "FarmOps Maintenance — Feature Demo";
const DESCRIPTION =
  "How FarmOps Maintenance keeps equipment serviced: plans built from real manuals, a rolling forecast, symptom diagnosis, service scheduling and completion history. PDF and PowerPoint handouts included.";

export const Route = createFileRoute("/demo/maintenance")({
  validateSearch: (search: Record<string, unknown>): DeckSearch =>
    parseDeckSearch(search, MAINTENANCE_DEMO_SLIDES.length),
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
  component: MaintenanceDemoPage,
});

function MaintenanceDemoPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <DeckViewer
      slides={MAINTENANCE_DEMO_SLIDES}
      deckName="FarmOps Maintenance"
      fileBase="FarmOps-Maintenance-Feature-Demo"
      search={search}
      slideLinks={MAINTENANCE_SLIDE_LINKS}
      onNavigate={(next, replace) => navigate({ search: next, replace })}
    />
  );
}
