import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { useSelfHostConfig } from "@/hooks/use-self-host-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  getAiModelPickerState,
  setAiModel,
  pullAiModel,
} from "@/lib/ai-models.functions";
import {
  AlertTriangle,
  CheckCircle2,
  Server,
  Cloud,
  Sparkles,
  Webhook,
  ExternalLink,
  RefreshCw,
  Download,
  Save,
} from "lucide-react";


export const Route = createFileRoute("/settings/self-host")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Self-Host Settings — Bostead" },
      {
        name: "description",
        content:
          "Review self-host mode status, AI provider routing, and Lovable-only feature fallbacks.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SelfHostSettingsPage,
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

function SelfHostSettingsPage() {
  const q = useSelfHostConfig();
  const cfg = q.data;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="h-6 w-6" />
            Self-host settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Runtime configuration for deployments outside the Lovable platform.
            All values are read from server-side environment variables and
            require a redeploy to change.
          </p>
        </header>

        {q.isLoading && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}
        {q.error && (
          <div className="text-sm text-destructive">
            Failed to load: {(q.error as Error).message}
          </div>
        )}

        {cfg && (
          <>
            {/* Mode banner */}
            <Card>
              <CardContent className="pt-6 flex items-center gap-3">
                {cfg.selfHostMode ? (
                  <>
                    <Server className="h-5 w-5 text-emerald-600" />
                    <div>
                      <div className="font-semibold">Self-host mode is ON</div>
                      <div className="text-sm text-muted-foreground">
                        Lovable-only UI (publish status, deployment host
                        info) is hidden. Set{" "}
                        <code>SELF_HOST_MODE=false</code> to restore it.
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <Cloud className="h-5 w-5 text-sky-600" />
                    <div>
                      <div className="font-semibold">
                        Self-host mode is OFF
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Running with Lovable-hosted defaults. Set{" "}
                        <code>SELF_HOST_MODE=true</code> in your environment
                        to hide Lovable-specific UI surfaces.
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* AI features */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4" />
                  AI features
                  <Badge
                    variant={
                      cfg.aiProvider === "none" ? "destructive" : "secondary"
                    }
                    className="ml-2"
                  >
                    {cfg.aiProvider === "custom" && "Custom endpoint"}
                    {cfg.aiProvider === "lovable" && "Lovable AI Gateway"}
                    {cfg.aiProvider === "none" && "Disabled"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {cfg.aiProvider === "none" ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
                    <div className="font-semibold flex items-center gap-2 text-amber-900 dark:text-amber-200">
                      <AlertTriangle className="h-4 w-4" />
                      LOVABLE_API_KEY is not set
                    </div>
                    <div className="mt-1 text-amber-900/90 dark:text-amber-100/90">
                      {cfg.aiFallbackNote}
                    </div>
                    <div className="mt-2 text-xs text-amber-900/80 dark:text-amber-100/80">
                      Fix: set <code>LOVABLE_API_KEY</code>, or configure a
                      custom endpoint with <code>CUSTOM_AI_BASE_URL</code>{" "}
                      and <code>CUSTOM_AI_API_KEY</code>.
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {cfg.aiFallbackNote}
                  </p>
                )}

                <div>
                  <Row
                    label="LOVABLE_API_KEY"
                    value={cfg.hasLovableApiKey ? "set" : "not set"}
                    ok={cfg.hasLovableApiKey}
                  />
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
                  <Row
                    label="CUSTOM_AI_MODEL"
                    value={cfg.customAiModel ?? "(defaults)"}
                  />
                </div>

                <div className="pt-2 text-xs text-muted-foreground">
                  Affected features:{" "}
                  <Link
                    to="/reports"
                    className="underline underline-offset-2"
                  >
                    /reports
                  </Link>{" "}
                  (draft generation),{" "}
                  <Link
                    to="/food/prices"
                    className="underline underline-offset-2"
                  >
                    /food/prices
                  </Link>{" "}
                  (Southern Ohio refresh), task detail pages (AI summary).
                </div>
              </CardContent>
            </Card>

            {/* Model picker (works for any OpenAI-compatible endpoint;
                shows richer metadata and enables pull for Ollama). */}
            {cfg.aiProvider !== "none" && <ModelPickerCard />}


            {/* Webhooks */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Webhook className="h-4 w-4" />
                  Outbound webhook origin
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Origin used when generating callback URLs sent to
                  third-party services (Rachio).
                </p>
                <Row
                  label="PUBLIC_APP_URL"
                  value={cfg.publicAppUrl ?? "(unset — using default)"}
                  ok={cfg.publicAppUrl ? true : null}
                />
                <Row
                  label="Rachio callback"
                  value={
                    <span className="flex items-center gap-1">
                      {cfg.webhookOrigin}/api/public/webhooks/rachio
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </span>
                  }
                  ok={cfg.publicAppUrl ? true : false}
                />
                {!cfg.publicAppUrl && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    Set <code>PUBLIC_APP_URL</code> to your externally
                    reachable origin (e.g.{" "}
                    <code>https://farm.example.com</code>) so Rachio calls
                    reach this deployment.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Lovable-only UI toggles */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Lovable-only UI surfaces
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row
                  label="Publish status panel (/sync)"
                  value={cfg.selfHostMode ? "hidden" : "visible"}
                />
                <p className="text-xs text-muted-foreground pt-2">
                  These surfaces classify the host by <code>*.lovable.app</code>{" "}
                  domains and are meaningless on a self-hosted deployment.
                  They are hidden automatically when self-host mode is on.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function ModelPickerCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(getAiModelPickerState);
  const saveFn = useServerFn(setAiModel);
  const pullFn = useServerFn(pullAiModel);

  const state = useQuery({
    queryKey: ["ai-model-picker"],
    queryFn: () => listFn(),
    staleTime: 30 * 1000,
  });

  const [selected, setSelected] = useState<string>("");
  const [pullInput, setPullInput] = useState<string>("");

  const save = useMutation({
    mutationFn: (model: string) => saveFn({ data: { model } }),
    onSuccess: (res) => {
      toast.success(`AI model set to ${res.model}`);
      qc.invalidateQueries({ queryKey: ["ai-model-picker"] });
      qc.invalidateQueries({ queryKey: ["self-host-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pull = useMutation({
    mutationFn: (model: string) => pullFn({ data: { model } }),
    onSuccess: (res) => {
      toast.success(`Pulled ${res.model}`);
      setPullInput("");
      qc.invalidateQueries({ queryKey: ["ai-model-picker"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const s = state.data;
  const effective = selected || s?.currentModel || "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          AI model picker
          {s?.isOllama && (
            <Badge variant="secondary" className="ml-2">
              Ollama
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs text-muted-foreground">
          Endpoint:{" "}
          <code>{s?.baseUrl ?? "(none configured)"}</code>
          {" · "}Current model:{" "}
          <code>{s?.currentModel ?? "(provider default)"}</code>
        </div>

        {state.isLoading && (
          <div className="text-sm text-muted-foreground">
            Loading available models…
          </div>
        )}

        {s && !state.isLoading && (
          <>
            {s.error && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-100">
                <div className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Couldn't list models
                </div>
                <div className="mt-1 font-mono text-xs">{s.error}</div>
                <div className="mt-1 text-xs">
                  You can still type a model id manually below.
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="flex-1 min-w-0">
                {s.models.length > 0 ? (
                  <Select
                    value={effective}
                    onValueChange={setSelected}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a model…" />
                    </SelectTrigger>
                    <SelectContent>
                      {s.models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <span className="font-mono">{m.id}</span>
                          {m.size ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {formatBytes(m.size)}
                              {m.detail ? ` · ${m.detail}` : ""}
                            </span>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="Model id (e.g. llama3.2:3b)"
                    value={effective}
                    onChange={(e) => setSelected(e.target.value)}
                  />
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => state.refetch()}
                title="Refresh model list"
                disabled={state.isFetching}
              >
                <RefreshCw
                  className={`h-4 w-4 ${state.isFetching ? "animate-spin" : ""}`}
                />
              </Button>
              <Button
                onClick={() => effective && save.mutate(effective)}
                disabled={
                  !effective ||
                  effective === s.currentModel ||
                  save.isPending
                }
              >
                <Save className="h-4 w-4 mr-1" />
                {save.isPending ? "Saving…" : "Save as active"}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Persists <code>CUSTOM_AI_MODEL</code> to the encrypted secrets
              vault (shared scope). Overrides the environment variable on
              this deployment without a redeploy.
            </p>

            {s.isOllama && (
              <div className="pt-3 border-t space-y-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Pull a new Ollama model
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    className="flex-1"
                    placeholder="qwen2.5:3b, llama3.1:8b, phi3:mini…"
                    value={pullInput}
                    onChange={(e) => setPullInput(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => pullInput.trim() && pull.mutate(pullInput.trim())}
                    disabled={!pullInput.trim() || pull.isPending}
                  >
                    {pull.isPending ? "Pulling…" : "Pull"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Downloads via Ollama's <code>/api/pull</code>. Small models
                  are a few GB; the request stays open until the pull
                  finishes (up to 10 minutes).
                </p>
              </div>
            )}

            {s.models.length > 0 && (
              <div className="pt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                {s.models.length} model{s.models.length === 1 ? "" : "s"} available
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

