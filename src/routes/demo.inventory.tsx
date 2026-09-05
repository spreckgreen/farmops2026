// /demo/inventory — public, anonymous feature demo for the Inventory module.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DeckViewer, parseDeckSearch, type DeckSearch } from "@/components/deck/deck-viewer";
import { INVENTORY_DEMO_SLIDES, INVENTORY_SLIDE_LINKS } from "@/lib/module-demo-slides";

const TITLE = "FarmOps Inventory — Feature Demo";
const DESCRIPTION =
  "How FarmOps Inventory tracks assets and parts: searchable register with barcodes, reviewable CSV import with rollback, parts lists with costs, and kits that check out and back in. PDF and PowerPoint handouts included.";

export const Route = createFileRoute("/demo/inventory")({
  validateSearch: (search: Record<string, unknown>): DeckSearch =>
    parseDeckSearch(search, INVENTORY_DEMO_SLIDES.length),
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
  component: InventoryDemoPage,
});

function InventoryDemoPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <DeckViewer
      slides={INVENTORY_DEMO_SLIDES}
      deckName="FarmOps Inventory"
      fileBase="FarmOps-Inventory-Feature-Demo"
      search={search}
      slideLinks={INVENTORY_SLIDE_LINKS}
      onNavigate={(next, replace) => navigate({ search: next, replace })}
    />
  );
}
