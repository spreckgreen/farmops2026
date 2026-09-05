import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { ModuleGate } from "@/components/module-gate";

export const Route = createFileRoute("/food")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Food Production — Bostead Farms" },
      {
        name: "description",
        content:
          "Track crops, livestock, processing batches, and food storage inventory.",
      },
    ],
  }),
  component: FoodLayout,
});

const TABS: Array<{ to: string; label: string; exact?: boolean }> = [
  { to: "/food/plan", label: "Plan" },
  { to: "/food", label: "Overview", exact: true },
  { to: "/food/irrigation", label: "Irrigation" },
  { to: "/food/crops", label: "Crops" },
  { to: "/food/garden", label: "Garden" },
  { to: "/food/orchard", label: "Orchard" },
  { to: "/food/livestock", label: "Livestock" },
  { to: "/food/processing", label: "Processing" },
  { to: "/food/preserve", label: "Preserve" },
  { to: "/food/storage", label: "Storage" },
  { to: "/food/prices", label: "Prices" },
  { to: "/food/seasons", label: "Seasons" },
  { to: "/food/reports", label: "Reports" },
];

function FoodLayout() {
  return (
    <ModuleGate moduleKey="food" title="Food & Growing">
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h1 className="text-2xl font-mono font-bold">Food Production</h1>
        </div>
        <nav className="flex flex-wrap gap-1 border-b border-border mb-6 -mx-1 px-1">
          {TABS.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              activeOptions={{ exact: t.exact ?? false }}
              className="px-3 py-2 text-sm font-mono text-muted-foreground hover:text-foreground border-b-2 border-transparent -mb-px"
              activeProps={{
                className:
                  "px-3 py-2 text-sm font-mono text-foreground border-b-2 border-foreground -mb-px",
              }}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <Outlet />
      </div>
    </AppLayout>
  );
}
