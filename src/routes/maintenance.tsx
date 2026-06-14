import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Wrench, Plus, Calendar, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/maintenance")({
  head: () => ({
    meta: [
      { title: "Maintenance — Bostead Farms" },
      { name: "description", content: "Service and maintenance records for Bostead Farms equipment." },
    ],
  }),
  component: MaintenancePage,
});

function MaintenancePage() {
  return (
    <AppLayout>
      <div className="min-h-[calc(100vh-3.5rem)] bg-[#0a0a0a] text-neutral-100">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex items-start justify-between gap-6 mb-10">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 mb-4">
                <Wrench className="h-3 w-3" /> Service Maintenance
              </div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
                Keep every asset <span className="text-amber-400">running smoothly.</span>
              </h1>
              <p className="mt-3 text-neutral-400 max-w-2xl">
                Track service intervals, log repairs, and schedule preventative maintenance across the farm.
              </p>
            </div>
            <Button className="bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold shrink-0">
              <Plus className="h-4 w-4 mr-1" /> New record
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
            {[
              { label: "Open work orders", value: "0", icon: Wrench },
              { label: "Due this week", value: "0", icon: Calendar },
              { label: "Overdue", value: "0", icon: AlertTriangle },
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
            <Wrench className="h-10 w-10 text-amber-400 mx-auto mb-3" />
            <h2 className="text-xl font-semibold mb-1">No maintenance records yet</h2>
            <p className="text-neutral-400 mb-4">Add your first service record to start tracking.</p>
            <Button className="bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold">
              <Plus className="h-4 w-4 mr-1" /> New record
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
