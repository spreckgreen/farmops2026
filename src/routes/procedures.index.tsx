import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Procedures } from "@/components/procedures";
import { ProceduresAiPrompt } from "@/components/procedures-ai-prompt";
import { InventorySopGenerator } from "@/components/inventory-sop-generator";
import { RunAiTestCard } from "@/components/run-ai-test-card";
import { Wand2 } from "lucide-react";

export const Route = createFileRoute("/procedures/")({
  component: ProceduresPage,
  head: () => ({
    meta: [
      { title: "Procedures — Bostead Farms" },
      {
        name: "description",
        content:
          "Editable TinyWiki procedures for farm SOPs, checklists, and reference notes.",
      },
      { property: "og:title", content: "Procedures — Bostead Farms" },
      {
        property: "og:description",
        content: "Farm SOPs, checklists, and reference notes as TinyWiki documents.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ProceduresPage() {
  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Procedures</h1>
            <p className="text-sm text-muted-foreground">
              Editable TinyWiki documents for farm SOPs, checklists, and reference notes.
              Each procedure is a self-contained .html file you can open, export, or import.
            </p>
          </div>
          <Button asChild variant="outline" className="gap-2">
            <Link to="/procedures/ingest">
              <Wand2 className="h-4 w-4" />
              Import &amp; summarize
            </Link>
          </Button>
        </header>
        <ProceduresAiPrompt />
        <InventorySopGenerator />
        <RunAiTestCard description="Verify the AI backend answering procedure queries is your self-hosted model on the VPS before running a long prompt." />
        <Procedures />
      </div>
    </AppLayout>
  );
}
