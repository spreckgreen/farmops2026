import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { SiteTracer } from "@/components/site-plan/site-tracer";

export const Route = createFileRoute("/site-plan")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  component: SitePlanPage,
  head: () => ({
    meta: [
      { title: "Site plan — measure buildings from aerial imagery | Bostead Farms" },
      {
        name: "description",
        content:
          "Trace building corners on satellite imagery to measure the footprint, orientation and reference grid for every structure on a site.",
      },
      { property: "og:title", content: "Site plan — measure buildings from aerial imagery" },
      {
        property: "og:description",
        content:
          "Trace building corners on satellite imagery to measure footprint, orientation and a reference grid per building.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function SitePlanPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Site plan</h1>
        <p className="text-sm text-muted-foreground">
          Build a measured outline of each building on a site from aerial imagery, name them largest
          to smallest, and link them to structures the app already knows.
        </p>
      </header>
      <SiteTracer />
    </main>
  );
}
