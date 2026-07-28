import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAiSettings } from "@/hooks/use-ai-settings";
import {
  AI_FEATURES,
  WEIGHT_META,
  isFeatureEnabled,
  type AiWeight,
} from "@/lib/ai-features";
import { Bot, ArrowLeft, RotateCcw, Zap, Gauge, Feather } from "lucide-react";

export const Route = createFileRoute("/admin/ai-settings")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "AI Configuration — Bostead" },
      {
        name: "description",
        content:
          "Enable or disable individual AI features and see their expected usage weight.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AiSettingsPage,
});

const WEIGHT_ICON: Record<AiWeight, React.ComponentType<{ className?: string }>> = {
  light: Feather,
  medium: Gauge,
  heavy: Zap,
};

function AiSettingsPage() {
  const { state, setMaster, setFeature, reset } = useAiSettings();

  const groups: Record<AiWeight, typeof AI_FEATURES> = {
    light: [],
    medium: [],
    heavy: [],
  };
  for (const f of AI_FEATURES) groups[f.weight].push(f);

  const activeCount = AI_FEATURES.filter((f) => isFeatureEnabled(state, f.id))
    .length;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <Link
            to="/admin"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to admin
          </Link>
        </div>

        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6" />
            AI configuration
          </h1>
          <p className="text-sm text-muted-foreground">
            Turn individual AI features on or off. Useful when you don't have
            a local AI agent (Ollama, LM Studio, etc.) available and want to
            avoid paid API calls or long waits.
          </p>
        </header>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">Master AI switch</CardTitle>
                <CardDescription>
                  When off, every AI feature is disabled regardless of its
                  individual setting. {activeCount} of {AI_FEATURES.length}{" "}
                  features are currently active.
                </CardDescription>
              </div>
              <Switch
                checked={state.masterEnabled}
                onCheckedChange={setMaster}
                aria-label="Master AI switch"
              />
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usage weight legend</CardTitle>
            <CardDescription>
              How heavy each feature is expected to be per invocation on a
              self-hosted model or paid API.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            {(Object.keys(WEIGHT_META) as AiWeight[]).map((w) => {
              const meta = WEIGHT_META[w];
              const Icon = WEIGHT_ICON[w];
              return (
                <div
                  key={w}
                  className={`rounded-md border px-2 py-2 ${meta.className}`}
                >
                  <div className="flex items-center gap-1 font-semibold">
                    <Icon className="h-3 w-3" /> {meta.label}
                  </div>
                  <div className="opacity-80">{meta.blurb}</div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {(["heavy", "medium", "light"] as AiWeight[]).map((w) => {
          if (groups[w].length === 0) return null;
          const meta = WEIGHT_META[w];
          const Icon = WEIGHT_ICON[w];
          return (
            <Card key={w}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${meta.className}`}
                  >
                    <Icon className="h-3 w-3" /> {meta.label} usage
                  </span>
                  <span className="text-muted-foreground text-xs font-normal">
                    {meta.blurb}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {groups[w].map((f, idx) => {
                  const enabled = isFeatureEnabled(state, f.id);
                  return (
                    <div key={f.id}>
                      {idx > 0 && <Separator className="mb-3" />}
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-medium text-sm">{f.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {f.description}
                          </div>
                          <div className="text-[11px] text-muted-foreground/80 mt-1">
                            Surface: {f.surfaces.join(", ")}
                          </div>
                        </div>
                        <Switch
                          checked={enabled}
                          onCheckedChange={(v) => setFeature(f.id, v)}
                          disabled={!state.masterEnabled}
                          aria-label={`Toggle ${f.label}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={reset}>
            <RotateCcw className="h-4 w-4 mr-1" /> Reset to defaults
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
