import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Package, Plus, Boxes, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory — Bostead Farms" },
      { name: "description", content: "Inventory tracking for Bostead Farms supplies and equipment." },
    ],
  }),
  component: InventoryPage,
});

function InventoryPage() {
  return (
    <AppLayout>
      <div className="min-h-[calc(100vh-3.5rem)] bg-[#0a0a0a] text-neutral-100">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex items-start justify-between gap-6 mb-10">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 mb-4">
                <Package className="h-3 w-3" /> Inventory
              </div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
                Know what's on hand, <span className="text-amber-400">always.</span>
              </h1>
              <p className="mt-3 text-neutral-400 max-w-2xl">
                Track supplies, feed, parts, and equipment across locations with reorder alerts.
              </p>
            </div>
            <Button className="bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold shrink-0">
              <Plus className="h-4 w-4 mr-1" /> New item
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
            {[
              { label: "Total items", value: "0", icon: Boxes },
              { label: "Locations", value: "0", icon: Package },
              { label: "Below reorder level", value: "0", icon: AlertTriangle },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-neutral-400">{s.label}</span>
                  <s.icon className="h-4 w-4 text-amber-400" />
                </div>
                <div className="text-3xl font-bold">{s.value}</div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-10 text-center">
            <Package className="h-10 w-10 text-amber-400 mx-auto mb-3" />
            <h2 className="text-xl font-semibold mb-1">No inventory items yet</h2>
            <p className="text-neutral-400 mb-4">Add your first item to start tracking stock.</p>
            <Button className="bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold">
              <Plus className="h-4 w-4 mr-1" /> New item
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
