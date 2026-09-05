// /demo/food — public, anonymous feature demo for the Food & Growing module.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DeckViewer, parseDeckSearch, type DeckSearch } from "@/components/deck/deck-viewer";
import { FOOD_DEMO_SLIDES, FOOD_SLIDE_LINKS } from "@/lib/module-demo-slides";

const TITLE = "FarmOps Food & Growing — Feature Demo";
const DESCRIPTION =
  "How FarmOps Food & Growing works: a food plan for the people you feed, garden, orchard and livestock registers, seasons, processing, preservation guidance, storage and price history. PDF and PowerPoint handouts included.";

export const Route = createFileRoute("/demo/food")({
  validateSearch: (search: Record<string, unknown>): DeckSearch =>
    parseDeckSearch(search, FOOD_DEMO_SLIDES.length),
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
  component: FoodDemoPage,
});

function FoodDemoPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <DeckViewer
      slides={FOOD_DEMO_SLIDES}
      deckName="FarmOps Food & Growing"
      fileBase="FarmOps-Food-And-Growing-Feature-Demo"
      search={search}
      slideLinks={FOOD_SLIDE_LINKS}
      onNavigate={(next, replace) => navigate({ search: next, replace })}
    />
  );
}
