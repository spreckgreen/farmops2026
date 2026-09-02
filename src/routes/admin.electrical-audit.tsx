// Administrator review queue for electrician field-record changes.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { ChangeAuditReport } from "@/components/electrical/change-audit-report";
import { requireAuthenticatedUser } from "@/lib/auth-route";

export const Route = createFileRoute("/admin/electrical-audit")({
  beforeLoad: requireAuthenticatedUser,
  component: ElectricalAuditAdminPage,
  head: () => ({
    meta: [
      { title: "Electrical Change Audit — Bostead Farms" },
      {
        name: "description",
        content:
          "Review every electrical field-record change made by electricians holding the field-write add-on, with field-level before and after values.",
      },
      { property: "og:title", content: "Electrical Change Audit — Bostead Farms" },
      {
        property: "og:description",
        content: "Administrator review of audited electrician edits to the electrical field record.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function ElectricalAuditAdminPage() {
  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <header>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Electrical change audit
          </h1>
          <p className="text-sm text-muted-foreground">
            Field-write electricians may record what they installed; every edit lands here for
            your review. Grant or withdraw the add-on under{" "}
            <Link to="/admin/addons" className="underline">
              Admin → Add-ons
            </Link>
            .
          </p>
        </header>
        <ChangeAuditReport actorLabel="Electrical change audit" />
      </div>
    </AppLayout>
  );
}
