import { createFileRoute } from "@tanstack/react-router";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { ParallelValidationReport } from "@/components/electrical/parallel-validation-report";

export const Route = createFileRoute("/electrical/validation")({
  component: ValidationPage,
  head: () => ({
    meta: [
      { title: "Electrical Parallel Validation (Phase 4.4) — Bostead Farms" },
      {
        name: "description",
        content:
          "Semantic comparison between the canonical electrical workbook and the FarmOps electrical model: matches, expected transformations, as-built additions, conflicts and semantic loss.",
      },
      {
        property: "og:title",
        content: "Electrical Parallel Validation (Phase 4.4) — Bostead Farms",
      },
      {
        property: "og:description",
        content:
          "Read-only Phase 4.4 validation of the FarmOps electrical model against the canonical engineering workbook.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ValidationPage() {
  return (
    <ElectricalGate>
      <ParallelValidationReport />
    </ElectricalGate>
  );
}
