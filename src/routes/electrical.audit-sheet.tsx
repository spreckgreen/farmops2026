// Audit sheet: a tablet-first walk-through for recording install progress in real
// time. It reads and writes the same authoritative electrical records the wiring
// page and the critical-load study use, so a tap in the field shows up everywhere.
import { createFileRoute } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { AuditSheet } from "@/components/electrical/audit-sheet";

export const Route = createFileRoute("/electrical/audit-sheet")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Audit Sheet — Bostead Farms Electrical" },
      {
        name: "description",
        content:
          "Tablet-friendly field audit sheet: walk the job panel by panel and record install stages, notes and progress on real electrical records in real time.",
      },
      { property: "og:title", content: "Audit Sheet — Bostead Farms Electrical" },
      {
        property: "og:description",
        content:
          "Record install stages for panels, breakers, circuits and loads as you walk the job, on a tablet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuditSheetPage,
});

function AuditSheetPage() {
  return (
    <ElectricalGate>
      <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-6 sm:py-6">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <ClipboardCheck className="h-6 w-6 shrink-0 text-primary" />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold sm:text-2xl">Audit sheet</h1>
              <p className="text-sm text-muted-foreground">
                Walk the job and tap the stage you see. Every entry updates the real record.
              </p>
            </div>
          </div>
        </header>
        <AuditSheet />
      </div>
    </ElectricalGate>
  );
}
