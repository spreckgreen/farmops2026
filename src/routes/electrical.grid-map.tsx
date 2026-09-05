// Full-screen Farm Shop grid map.
import { createFileRoute, Link } from "@tanstack/react-router";
import { TermHint } from "@/components/electrical/term-hint";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { GridOperationalMap } from "@/components/electrical/grid-operational-map";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/electrical/grid-map")({
  component: GridMapPage,
  head: () => ({
    meta: [
      { title: "Farm Shop Grid Map — Bostead Farms Electrical" },
      {
        name: "description",
        content:
          "Full-screen Farm Shop grid map plotting recorded loads by circuit class and grid coordinate, filterable by panel.",
      },
      { property: "og:title", content: "Farm Shop Grid Map — Bostead Farms Electrical" },
      {
        property: "og:description",
        content: "Recorded Farm Shop loads plotted on the corrected 40' x 60' overhead grid plan.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function GridMapPage() {
  return (
    <ElectricalGate>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Farm Shop grid map</h1>
          <Button asChild size="sm" variant="outline">
            <Link to="/electrical">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Overview
            </Link>
          </Button>
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          Terms used on this map:
          <TermHint id="grid_reference" />
          <TermHint id="pole_grid" />
          <TermHint id="circuit_group" />
        </p>
        <GridOperationalMap large />
      </div>
    </ElectricalGate>
  );
}
