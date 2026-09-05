// FARMOPS-ELEC-AUDIT-BATCH-V1 — bulk electrical field-audit workspace.
import { createFileRoute } from "@tanstack/react-router";

import { AuditBatchPanel } from "@/components/electrical/audit-batch-panel";
import { TermHint } from "@/components/electrical/term-hint";
import { ElectricalGate } from "@/components/electrical/electrical-gate";

export const Route = createFileRoute("/electrical/audit-batches")({
  component: AuditBatchesPage,
  head: () => ({
    meta: [
      { title: "Electrical Audit Batches — Bostead Farms" },
      {
        name: "description",
        content:
          "Import a structured field-audit manifest, preview exact electrical record changes without writing, approve individual observations and apply them as one guarded transaction.",
      },
      { property: "og:title", content: "Electrical Audit Batches — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Bulk field-audit import, preview, owner approval and guarded apply for FarmOps electrical records.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function AuditBatchesPage() {
  return (
    <ElectricalGate>
      <div className="space-y-3">
        <header>
          <h1 className="text-lg font-semibold">Electrical audit batches</h1>
          <p className="text-sm text-muted-foreground">
            Bulk field audits are staged, validated and previewed here. Nothing is written to an
            electrical record until you approve individual observations; holds, conflicts and
            design-only changes stay unapplied and export as ODS correction candidates instead.
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            Terms used here:
            <TermHint id="audit_batch" />
            <TermHint id="as_built_verified" />
            <TermHint id="circuit_group" />
          </p>
          <p className="text-sm text-muted-foreground">
            An accepted as-built observation carries its consequences in the same preview and the
            same approval: the circuit relationship, a direct advance to complete (no artificial
            material-ready or installation taps), shared or dedicated from how many loads share the
            circuit, building from the panel it hangs off, and any grid cell or post the audit
            actually observed. Testing and energization are only recorded when they were explicitly
            observed, and every change is shown as an exact before-and-after difference first.
          </p>
        </header>
        <AuditBatchPanel />
      </div>
    </ElectricalGate>
  );
}
