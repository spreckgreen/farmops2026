// Site Grids — aerial site plan tracing and per-building grid definition in one place.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { SiteTracer } from "@/components/site-plan/site-tracer";
import { BuildingGridDefiner } from "@/components/site-plan/building-grid-definer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/electrical/site-grids")({
  ssr: false,
  component: SiteGridsPage,
  head: () => ({
    meta: [
      { title: "Site Grids — site plans and building grids | Bostead Farms Electrical" },
      {
        name: "description",
        content:
          "Trace buildings from aerial imagery and define a location grid per building — site plans and building grids together under Electrical.",
      },
      { property: "og:title", content: "Site Grids — site plans and building grids" },
      {
        property: "og:description",
        content:
          "Measure building footprints from satellite imagery and set up per-building location grids with orientation and walk order.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function SiteGridsPage() {
  return (
    <ElectricalGate>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Site grids</h1>
          <Button asChild size="sm" variant="outline">
            <Link to="/electrical">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Overview
            </Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Build a measured outline of each building on a site, then give each building its own
          location grid — for a brand new site, or to add another outbuilding to a site you already
          have.
        </p>

        <Tabs defaultValue="site-plan" className="space-y-3">
          <TabsList>
            <TabsTrigger value="site-plan">Site plan</TabsTrigger>
            <TabsTrigger value="building-grids">Building grids</TabsTrigger>
          </TabsList>
          <TabsContent value="site-plan" className="space-y-3">
            <SiteTracer />
          </TabsContent>
          <TabsContent value="building-grids" className="space-y-3">
            <BuildingGridDefiner />
          </TabsContent>
        </Tabs>
      </div>
    </ElectricalGate>
  );
}
