// An electrician's own audited change history, inside the Electrical module.
import { createFileRoute } from "@tanstack/react-router";

import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { ChangeAuditReport } from "@/components/electrical/change-audit-report";
import { requireAuthenticatedUser } from "@/lib/auth-route";

export const Route = createFileRoute("/electrical/changes")({
  beforeLoad: requireAuthenticatedUser,
  component: ElectricalChangesPage,
  head: () => ({
    meta: [
      { title: "Electrical Change Log — Bostead Farms" },
      {
        name: "description",
        content:
          "Every edit recorded in the Bostead electrical field record, with field-level before and after values and administrator review status.",
      },
      { property: "og:title", content: "Electrical Change Log — Bostead Farms" },
      {
        property: "og:description",
        content: "Audited history of electrical field-record edits awaiting administrator review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function ElectricalChangesPage() {
  return (
    <ElectricalGate>
      <ChangeAuditReport />
    </ElectricalGate>
  );
}
