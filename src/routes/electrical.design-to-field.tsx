// FARMOPS-ELEC-DESIGN-TO-FIELD-V1 — design submission, field acceptance, history.
import { createFileRoute } from "@tanstack/react-router";

import { DesignToFieldPanel } from "@/components/electrical/design-to-field-panel";
import { ElectricalGate } from "@/components/electrical/electrical-gate";

export const Route = createFileRoute("/electrical/design-to-field")({
  component: DesignToFieldPage,
  head: () => ({
    meta: [
      { title: "Design to Field Locations — Bostead Farms" },
      {
        name: "description",
        content:
          "Submit approved design coordinates for an electrical record, then accept the field evidence that supersedes them, with an exact before-and-after history of every location change.",
      },
      { property: "og:title", content: "Design to Field Locations — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Two-step approved design and field-evidence workflow for FarmOps electrical record locations, with full change history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function DesignToFieldPage() {
  return (
    <ElectricalGate>
      <div className="space-y-3">
        <header>
          <h1 className="text-lg font-semibold">Design to field locations</h1>
          <p className="text-sm text-muted-foreground">
            Two separate, separately approved steps for one record. First the approved design
            position is recorded in exact feet with its approval reference — the lifecycle stays as
            it is and the position stays unverified. Later, accepted field evidence records where
            the equipment actually landed and takes over the shown location, while the design
            position, its approval and every earlier value stay on record for comparison.
          </p>
        </header>
        <DesignToFieldPanel />
      </div>
    </ElectricalGate>
  );
}
