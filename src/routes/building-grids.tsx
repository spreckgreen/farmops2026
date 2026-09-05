import { createFileRoute, Link } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { BuildingGridDefiner } from "@/components/site-plan/building-grid-definer";

export const Route = createFileRoute("/building-grids")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  component: BuildingGridsPage,
  head: () => ({
    meta: [
      { title: "Building grids — define a location grid per building | Bostead Farms" },
      {
        name: "description",
        content:
          "Define a starting location grid for any building from its measured size, a standard shape, or an uploaded corner list, SVG or DXF drawing.",
      },
      { property: "og:title", content: "Building grids — define a location grid per building" },
      {
        property: "og:description",
        content:
          "Set up per-building location grids from typed dimensions, standard shapes or uploaded drawings, with orientation and walk-around order.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function BuildingGridsPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Building grids</h1>
        <p className="text-sm text-muted-foreground">
          Give a building its own location grid from measured dimensions, a standard shape, or a
          drawing you upload. Use this for a brand new site, or to add another outbuilding — a boiler
          room, pump house or the house — to a site you already have.
        </p>
        <p className="text-sm text-muted-foreground">
          Prefer to measure from aerial imagery instead?{" "}
          <Link to="/site-plan" className="underline">
            Use the site plan tracer
          </Link>
          .
        </p>
      </header>
      <BuildingGridDefiner />
    </main>
  );
}
