// Building Levels — floors for each building, ahead of the grid in the location
// hierarchy: site → building → level → grid scheme → grid reference.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { BuildingLevelManager } from "@/components/site-plan/building-level-manager";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/electrical/building-levels")({
  ssr: false,
  component: BuildingLevelsPage,
  head: () => ({
    meta: [
      { title: "Building Levels — floors and level grids | Bostead Farms Electrical" },
      {
        name: "description",
        content:
          "Define each building's floors, give every level its own grid, and keep the same grid reference safely distinct between floors.",
      },
      { property: "og:title", content: "Building Levels — floors and level grids" },
      {
        property: "og:description",
        content:
          "Floors are first-class: A1 on the ground floor and A1 upstairs are different places, and moving something between floors never renames it.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function BuildingLevelsPage() {
  return (
    <ElectricalGate>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Building levels</h1>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/electrical/building-grid">Building grid</Link>
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
          Floors come before the grid: the same grid reference can exist on every floor without
          clashing. Single-storey buildings simply keep one Ground Floor and read exactly as before.
        </p>
        <BuildingLevelManager />
      </div>
    </ElectricalGate>
  );
}
