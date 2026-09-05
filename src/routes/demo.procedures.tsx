// /demo/procedures — public, anonymous feature demo for the free-forever
// Procedures knowledge base module.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DeckViewer, parseDeckSearch, type DeckSearch } from "@/components/deck/deck-viewer";
import { PROCEDURES_DEMO_SLIDES, PROCEDURES_SLIDE_LINKS } from "@/lib/module-demo-slides";

const TITLE = "FarmOps Procedures — Feature Demo (free forever)";
const DESCRIPTION =
  "The free FarmOps knowledge base: editable procedure pages, document import and summarising, SOP generation, and links from inventory, kits and maintenance manuals. PDF and PowerPoint handouts included.";

export const Route = createFileRoute("/demo/procedures")({
  validateSearch: (search: Record<string, unknown>): DeckSearch =>
    parseDeckSearch(search, PROCEDURES_DEMO_SLIDES.length),
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
  component: ProceduresDemoPage,
});

function ProceduresDemoPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <DeckViewer
      slides={PROCEDURES_DEMO_SLIDES}
      deckName="FarmOps Procedures"
      fileBase="FarmOps-Procedures-Feature-Demo"
      search={search}
      slideLinks={PROCEDURES_SLIDE_LINKS}
      onNavigate={(next, replace) => navigate({ search: next, replace })}
    />
  );
}
