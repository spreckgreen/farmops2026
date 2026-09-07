// One kit's build-out: parts list, sizes, stack positions and the drawn stack —
// the same workspace used for equipment racks.
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { KitBuildCard } from "@/components/kit-build-card";

export const Route = createFileRoute("/kits-racks/$kitId")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Kit build-out — Bostead Farms" },
      {
        name: "description",
        content:
          "Work on one kit's build-out: its parts, the spaces each part takes and where it sits in the stack.",
      },
      { property: "og:title", content: "Kit build-out — Bostead Farms" },
      {
        property: "og:description",
        content: "Kit parts, sizes and stack positions recorded for the farm's equipment.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KitBuildPage,
});

function KitBuildPage() {
  const { kitId } = Route.useParams();
  return (
    <AppLayout>
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Kit build-out</h1>
          <Button size="sm" variant="outline" asChild>
            <Link to="/kits-racks">
              <ArrowLeft className="mr-1 h-4 w-4" /> All kits &amp; racks
            </Link>
          </Button>
        </div>
        <KitBuildCard kitItemId={kitId} />
      </div>
    </AppLayout>
  );
}
