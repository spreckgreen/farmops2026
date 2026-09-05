// /demo/farmops_o_s — public, anonymous-access demo for FarmOps O/S: the
// platform layer, the free Procedures module, and the paid modules that already
// run in the application.
//
// No auth loader, no record reads — static slide content only.
// ?slide=4 keeps a shared link on one page, ?view=grid shows all pages,
// ?view=print stacks them for PDF, download=1 opens the print dialog, and the
// header also offers a PowerPoint handout.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DeckViewer, parseDeckSearch, type DeckSearch } from "@/components/deck/deck-viewer";
import { FARMOPS_OS_DEMO_SLIDES } from "@/lib/farmops-os-demo-slides";
import { FARMOPS_OS_SLIDE_LINKS } from "@/lib/farmops-os-demo-links";

const TITLE = "FarmOps O/S — Feature Demo";
const DESCRIPTION =
  "A walkthrough of FarmOps O/S: the shared platform layer, the free-forever Procedures knowledge base, and the Electrical, Maintenance, Inventory, Food and Security modules, each with its own feature deck.";

export const Route = createFileRoute("/demo/farmops_o_s")({
  validateSearch: (search: Record<string, unknown>): DeckSearch =>
    parseDeckSearch(search, FARMOPS_OS_DEMO_SLIDES.length),
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
  component: FarmOpsOsDemoPage,
});

function FarmOpsOsDemoPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <DeckViewer
      slides={FARMOPS_OS_DEMO_SLIDES}
      deckName="FarmOps O/S"
      fileBase="FarmOps-OS-Feature-Demo"
      search={search}
      slideLinks={FARMOPS_OS_SLIDE_LINKS as never}
      onNavigate={(next, replace) => navigate({ search: next, replace })}
    />
  );
}
