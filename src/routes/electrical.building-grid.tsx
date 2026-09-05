// Building Grid — rooms, areas and their circuits inside a building defined in Site Grids.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { BuildingAreasManager } from "@/components/site-plan/building-areas-manager";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/electrical/building-grid")({
  ssr: false,
  component: BuildingGridPage,
  head: () => ({
    meta: [
      { title: "Building Grid — rooms, areas and circuits | Bostead Farms Electrical" },
      {
        name: "description",
        content:
          "Define rooms, areas and the circuits that serve them inside each building's location grid, linked to Site Grids.",
      },
      { property: "og:title", content: "Building Grid — rooms, areas and circuits" },
      {
        property: "og:description",
        content:
          "Lay out rooms and areas on a building's own location grid and record which circuits serve each one.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function BuildingGridPage() {
  return (
    <ElectricalGate>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Building grid</h1>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/electrical/site-grids">Site grids</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/electrical">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Overview
              </Link>
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Work inside one building at a time: name its rooms and areas on the building's own
          location grid, then record the circuits that serve each one.
        </p>
        <BuildingAreasManager />
      </div>
    </ElectricalGate>
  );
}
