// /demo/security — public, anonymous feature demo for the Security module
// (camera register, coverage and live feeds).
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DeckViewer, parseDeckSearch, type DeckSearch } from "@/components/deck/deck-viewer";
import { SECURITY_DEMO_SLIDES, SECURITY_SLIDE_LINKS } from "@/lib/module-demo-slides";

const TITLE = "FarmOps Security — Feature Demo";
const DESCRIPTION =
  "How FarmOps Security records cameras: stable identities, playable live feeds, checked status with freshness, coverage cones drawn only from recorded position and aim, compass placement before a grid exists, local bridges, and electrical records for each camera.";

export const Route = createFileRoute("/demo/security")({
  validateSearch: (search: Record<string, unknown>): DeckSearch =>
    parseDeckSearch(search, SECURITY_DEMO_SLIDES.length),
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
  component: SecurityDemoPage,
});

function SecurityDemoPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <DeckViewer
      slides={SECURITY_DEMO_SLIDES}
      deckName="FarmOps Security"
      fileBase="FarmOps-Security-Feature-Demo"
      search={search}
      slideLinks={SECURITY_SLIDE_LINKS}
      onNavigate={(next, replace) => navigate({ search: next, replace })}
    />
  );
}
