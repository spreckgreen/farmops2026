import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { Procedures } from "@/components/procedures";
import { ProceduresAiPrompt } from "@/components/procedures-ai-prompt";

export const Route = createFileRoute("/procedures")({
  component: ProceduresPage,
  errorComponent: ({ error }) => (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 text-sm text-destructive">
        Failed to load procedures: {error.message}
      </div>
    </AppLayout>
  ),
  notFoundComponent: () => (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 text-sm text-muted-foreground">Not found.</div>
    </AppLayout>
  ),
});

function ProceduresPage() {
  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Procedures</h1>
          <p className="text-sm text-muted-foreground">
            Editable TinyWiki documents for farm SOPs, checklists, and reference notes.
            Each procedure is a self-contained .html file you can open, export, or import.
          </p>
        </header>
        <ProceduresAiPrompt />
        <Procedures />
      </div>
    </AppLayout>
  );
}
