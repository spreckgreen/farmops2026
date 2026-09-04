// Consolidated Farm Shop grid reconciliation workspace: status, field
// verification, canonical comparison, per-record repair and read-only history.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import {
  DATA_QUALITY_TABS,
  GridDataQualityPanel,
  type DataQualityTab,
} from "@/components/electrical/grid-data-quality-panel";
import { PostGeometryProposal } from "@/components/electrical/post-geometry-proposal";

const searchSchema = z.object({
  tab: z.enum(DATA_QUALITY_TABS as unknown as [DataQualityTab, ...DataQualityTab[]]).catch("status"),
});

export const Route = createFileRoute("/electrical/grid-data-quality")({
  validateSearch: searchSchema,
  component: GridDataQualityPage,
  head: () => ({
    meta: [
      { title: "Electrical Grid Data Quality — Bostead Farms" },
      {
        name: "description",
        content:
          "Farm Shop grid reconciliation workspace: install-location status, walkaround field verification, canonical comparison, audited per-record repair and migration history.",
      },
      { property: "og:title", content: "Electrical Grid Data Quality — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Status, field verification, canonical comparison, repair and history for Farm Shop install locations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function GridDataQualityPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <ElectricalGate>
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Electrical grid data quality</h1>
        <GridDataQualityPanel
          tab={tab}
          onTabChange={(t) => navigate({ search: { tab: t } })}
        />
        <PostGeometryProposal />
      </div>

    </ElectricalGate>
  );
}
