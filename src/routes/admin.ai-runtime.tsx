import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { useSelfHostConfig } from "@/hooks/use-self-host-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AiFeatureRouting } from "@/components/ai-feature-routing";
import { AiWorkflowTests } from "@/components/ai-workflow-tests";
import { ModelPickerCard } from "@/components/ai-model-picker-card";
import { AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/admin/ai-runtime")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "AI runtime — Bostead Admin" },
      {
        name: "description",
        content:
          "Active AI endpoint, model picker, per-feature routing, and workflow tests for this Bostead deployment.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AiRuntimePage,
});

function Row({
  label,
  value,
  ok,
}: {
  label: string;
  value: React.ReactNode;
  ok?: boolean | null;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-b-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2 text-sm font-mono">
        {ok === true && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
        {ok === false && <AlertTriangle className="h-4 w-4 text-amber-600" />}
        <span>{value}</span>
      </div>
    </div>
  );
}

function AiRuntimePage() {
  const q = useSelfHostConfig();
  const cfg = q.data;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6" />
            AI runtime
          </h1>
          <p className="text-sm text-muted-foreground">
            Active endpoint, model selection, per-feature routing, and workflow
            tests. Credentials for each engine live under{" "}
            <Link to="/admin/ai-engines" className="underline underline-offset-2">
              AI engines
            </Link>
            .
          </p>
        </header>

        {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {q.error && (
          <div className="text-sm text-destructive">
            Failed to load: {(q.error as Error).message}
          </div>
        )}

        {cfg && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4" />
                  AI features
                  <Badge
                    variant={cfg.aiProvider === "none" ? "destructive" : "secondary"}
                    className="ml-2"
                  >
                    {cfg.aiProvider === "custom" && "Custom endpoint"}
                    {cfg.aiProvider === "none" && "Disabled"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {cfg.aiProvider === "none" ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
                    <div className="font-semibold flex items-center gap-2 text-amber-900 dark:text-amber-200">
                      <AlertTriangle className="h-4 w-4" />
                      AI endpoint is not configured
                    </div>
                    <div className="mt-1 text-amber-900/90 dark:text-amber-100/90">
                      {cfg.aiFallbackNote}
                    </div>
                    <div className="mt-2 text-xs text-amber-900/80 dark:text-amber-100/80">
                      Configure a custom endpoint with <code>CUSTOM_AI_BASE_URL</code> and{" "}
                      <code>CUSTOM_AI_API_KEY</code>.
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{cfg.aiFallbackNote}</p>
                )}

                <div>
                  <Row
                    label="CUSTOM_AI_BASE_URL"
                    value={cfg.customAiBaseUrl ?? "—"}
                    ok={cfg.hasCustomAi ? true : null}
                  />
                  <Row
                    label="CUSTOM_AI_API_KEY"
                    value={cfg.hasCustomAi ? "set" : "not set"}
                    ok={cfg.hasCustomAi ? true : null}
                  />
                  <Row label="CUSTOM_AI_MODEL" value={cfg.customAiModel ?? "(defaults)"} />
                </div>

                <div className="pt-2 text-xs text-muted-foreground">
                  Affected features:{" "}
                  <Link to="/reports" className="underline underline-offset-2">
                    /reports
                  </Link>{" "}
                  (draft generation),{" "}
                  <Link to="/food/prices" className="underline underline-offset-2">
                    /food/prices
                  </Link>{" "}
                  (Southern Ohio refresh), task detail pages (AI summary).
                </div>
              </CardContent>
            </Card>

            {cfg.aiProvider !== "none" && <ModelPickerCard />}

            <AiFeatureRouting />

            <Card>
              <CardContent className="pt-4">
                <AiWorkflowTests />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
