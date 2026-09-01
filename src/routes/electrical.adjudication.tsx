import { createFileRoute } from "@tanstack/react-router";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { LoadAdjudicationReport } from "@/components/electrical/load-adjudication-report";

export const Route = createFileRoute("/electrical/adjudication")({
  component: AdjudicationPage,
  head: () => ({
    meta: [
      { title: "Load Semantic Adjudication (Phase 4.4b) — Bostead Farms" },
      {
        name: "description",
        content:
          "Read-only adjudication of nine former Category-B load findings across FS-034, FS-082, FS-083, FS-084 and FS-092 into four semantic buckets with provenance and advisory recommendations.",
      },
      {
        property: "og:title",
        content: "Load Semantic Adjudication (Phase 4.4b) — Bostead Farms",
      },
      {
        property: "og:description",
        content:
          "Provenance-gated classification of load voltage, current and connected VA disagreements. No writes and no apply path.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function AdjudicationPage() {
  return (
    <ElectricalGate>
      <LoadAdjudicationReport />
    </ElectricalGate>
  );
}
