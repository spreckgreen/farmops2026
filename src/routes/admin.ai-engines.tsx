import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getAiEngines,
  setAiEngines,
  switchHostedToLovableAi,
  testAiEngineConnection,
} from "@/lib/ai-engines.functions";
import type { EngineTestResult } from "@/lib/ai-engine-test.server";
import { AI_ENGINE_DEFS, type AiEngineId } from "@/lib/ai-engines";
import {
  ArrowLeft,
  Cloud,
  Server,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PlugZap,
  XCircle,
} from "lucide-react";

export const Route = createFileRoute("/admin/ai-engines")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "AI engines — Bostead" },
      {
        name: "description",
        content:
          "Configure Bostead's four AI engines — self-hosted local, Ollama Cloud, Lovable AI and another cloud provider.",
      },
      { property: "og:title", content: "AI engines — Bostead" },
      {
        property: "og:description",
        content:
          "Configure the four AI engines that power Bostead's reports, schedules and knowledge base.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AiEnginesPage,
});

interface TargetDraft {
  baseUrl: string;
  apiKey: string;
  keyTouched: boolean;
  model: string;
}

const emptyDraft: TargetDraft = { baseUrl: "", apiKey: "", keyTouched: false, model: "" };

type Drafts = Record<AiEngineId, TargetDraft>;

const emptyDrafts = (): Drafts => ({
  local: { ...emptyDraft },
  ollama_cloud: { ...emptyDraft },
  lovable: { ...emptyDraft },
  other_cloud: { ...emptyDraft },
});

function AiEnginesPage() {
  const load = useServerFn(getAiEngines);
  const save = useServerFn(setAiEngines);
  const switchToLovable = useServerFn(switchHostedToLovableAi);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["ai-engines"],
    queryFn: () => load({}),
  });

  const [drafts, setDrafts] = useState<Drafts>(emptyDrafts);
  const [cloudDefault, setCloudDefault] = useState<AiEngineId>("lovable");
  /** Engines whose endpoint/key fields are revealed (managed engines hide them). */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!data) return;
    const next = emptyDrafts();
    for (const def of AI_ENGINE_DEFS) {
      const stored = data.config.engines[def.id];
      next[def.id] = {
        baseUrl: stored.baseUrl ?? "",
        apiKey: "",
        keyTouched: false,
        model: stored.model ?? "",
      };
    }
    setDrafts(next);
    setCloudDefault(data.config.cloudDefault);
  }, [data]);

  const [tests, setTests] = useState<Partial<Record<AiEngineId, EngineTestResult>>>({});
  const [testing, setTesting] = useState<AiEngineId | null>(null);
  const runTest = useServerFn(testAiEngineConnection);

  const testEngine = async (id: AiEngineId) => {
    const d = drafts[id];
    setTesting(id);
    try {
      const result = await runTest({
        data: {
          id,
          baseUrl: d.baseUrl.trim() || null,
          apiKey: d.keyTouched ? d.apiKey : null,
          model: d.model.trim() || null,
        },
      });
      setTests((prev) => ({ ...prev, [id]: result }));
      if (result.ok) toast.success(`${result.title}: ${result.message}`);
      else toast.error(result.title);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection test failed";
      setTests((prev) => ({
        ...prev,
        [id]: {
          ok: false,
          title: "Test could not run",
          message,
          hint: null,
          baseUrl: null,
          model: null,
          modelsSeen: [],
          modelFound: null,
          latencyMs: null,
          httpStatus: null,
        },
      }));
      toast.error(message);
    } finally {
      setTesting(null);
    }
  };

  const patch = (id: AiEngineId, value: Partial<TargetDraft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...value } }));

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          cloudDefault,
          engines: Object.fromEntries(
            AI_ENGINE_DEFS.map((def) => {
              const d = drafts[def.id];
              return [
                def.id,
                {
                  baseUrl: d.baseUrl.trim() || null,
                  apiKey: d.keyTouched ? d.apiKey : null,
                  model: d.model.trim() || null,
                },
              ];
            }),
          ),
        },
      }),
    onSuccess: (result) => {
      const warnings = "warnings" in result ? (result.warnings ?? []) : [];
      toast.success("AI engine configuration saved");
      for (const w of warnings) toast.warning(w);
      void qc.invalidateQueries({ queryKey: ["ai-engines"] });
      void qc.invalidateQueries({ queryKey: ["ai-routing"] });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not save engines"),
  });

  const lovableMutation = useMutation({
    mutationFn: () => switchToLovable({}),
    onSuccess: (result) => {
      const extras = [
        result.clearedKeys.length ? `cleared ${result.clearedKeys.join(", ")}` : null,
        result.switchedAreas.length
          ? `${result.switchedAreas.length} feature area(s) moved to Lovable AI`
          : null,
      ].filter(Boolean);
      toast.success(
        `Cloud default is now Lovable AI${extras.length ? ` — ${extras.join("; ")}` : ""}`,
      );
      if (result.envStillSet) {
        toast.warning(
          "CUSTOM_AI_BASE_URL / CUSTOM_AI_API_KEY are still set as deploy env vars — remove them from .env to fully stop custom routing.",
        );
      }
      void qc.invalidateQueries({ queryKey: ["ai-engines"] });
      void qc.invalidateQueries({ queryKey: ["ai-routing"] });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not switch to Lovable AI"),
  });

  const cloudEngines = AI_ENGINE_DEFS.filter((e) => e.placement === "cloud");

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to admin
        </Link>

        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6" />
            AI engines
          </h1>
          <p className="text-sm text-muted-foreground">
            Four engines run side by side — self-hosted local, Ollama Cloud, Lovable AI and
            another cloud provider. Each AI feature picks one in{" "}
            <Link to="/settings/self-host" className="underline underline-offset-2">
              Self-host settings
            </Link>
            .
          </p>
        </header>

        {isLoading || !data ? (
          <p className="text-sm text-muted-foreground">Loading engine configuration…</p>
        ) : (
          <>
            {AI_ENGINE_DEFS.map((def) => {
              const d = drafts[def.id];
              const stored = data.config.engines[def.id];
              const status = data.availability[def.id];
              return (
                <Card key={def.id}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {def.placement === "local" ? (
                        <Server className="h-4 w-4" />
                      ) : (
                        <Cloud className="h-4 w-4" />
                      )}
                      {def.label}
                      <Badge variant={status.available ? "secondary" : "outline"}>
                        {status.available ? "ready" : "not configured"}
                      </Badge>
                      {data.config.cloudDefault === def.id && (
                        <Badge>cloud default</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {def.description}
                      {status.available ? (
                        <>
                          {" "}
                          Effective now: <code>{status.baseUrl}</code> ·{" "}
                          <code>{status.model}</code>
                        </>
                      ) : null}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {def.keyFromEnv && !data.hasLovableApiKey && !stored.hasApiKey && (
                      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
                        <AlertTriangle className="h-4 w-4 mt-0.5" />
                        <span>
                          <code>LOVABLE_API_KEY</code> is not set on this server (normal for a
                          self-hosted deploy). Leave this engine alone and use another one, or
                          reveal the override below and paste a key. Either way the other
                          engines save and run normally.
                        </span>
                      </div>
                    )}
                    {def.keyFromEnv && data.hasLovableApiKey && !stored.hasApiKey && (
                      <p className="text-xs text-muted-foreground">
                        Managed by Lovable — nothing to set up. The server&apos;s{" "}
                        <code>LOVABLE_API_KEY</code>, base URL and model defaults are used
                        automatically.
                      </p>
                    )}
                    {def.keyFromEnv && !overrides[def.id] && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="px-0 text-xs"
                        onClick={() =>
                          setOverrides((prev) => ({ ...prev, [def.id]: true }))
                        }
                      >
                        Advanced: override endpoint / key
                      </Button>
                    )}
                    {(!def.keyFromEnv || overrides[def.id] || stored.hasApiKey) && (
                      <>
                        <div className="space-y-1">
                          <Label htmlFor={`${def.id}-base`}>Base URL</Label>
                          <Input
                            id={`${def.id}-base`}
                            placeholder={def.defaultBaseUrl ?? "https://…/v1"}
                            value={d.baseUrl}
                            onChange={(e) => patch(def.id, { baseUrl: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`${def.id}-key`}>
                            API key{" "}
                            {stored.hasApiKey && <Badge variant="secondary">stored</Badge>}
                          </Label>
                          <Input
                            id={`${def.id}-key`}
                            type="password"
                            autoComplete="off"
                            placeholder={
                              stored.hasApiKey
                                ? "•••••• (leave blank to keep)"
                                : def.id === "local"
                                  ? "ollama"
                                  : "sk-…"
                            }
                            value={d.apiKey}
                            onChange={(e) =>
                              patch(def.id, { apiKey: e.target.value, keyTouched: true })
                            }
                          />
                        </div>
                      </>
                    )}
                    <div className="space-y-1">
                      <Label htmlFor={`${def.id}-model`}>Model</Label>
                      <Input
                        id={`${def.id}-model`}
                        className="font-mono text-xs"
                        placeholder={def.defaultModel ?? "openai/gpt-4.1"}
                        value={d.model}
                        onChange={(e) => patch(def.id, { model: e.target.value })}
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void testEngine(def.id)}
                        disabled={testing !== null}
                      >
                        {testing === def.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <PlugZap className="h-4 w-4" />
                        )}
                        {testing === def.id ? "Testing…" : "Test connection"}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Checks the base URL, key and model without saving.
                      </span>
                    </div>

                    {tests[def.id] && (
                      <div
                        className={`rounded-md border p-3 text-sm space-y-1 ${
                          tests[def.id]!.ok
                            ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30"
                            : "border-destructive/40 bg-destructive/5"
                        }`}
                      >
                        <p className="flex items-center gap-2 font-medium">
                          {tests[def.id]!.ok ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <XCircle className="h-4 w-4" />
                          )}
                          {tests[def.id]!.title}
                          {tests[def.id]!.latencyMs !== null && (
                            <span className="text-xs font-normal text-muted-foreground">
                              {tests[def.id]!.latencyMs} ms
                            </span>
                          )}
                        </p>
                        <p className="text-muted-foreground">{tests[def.id]!.message}</p>
                        {tests[def.id]!.hint && (
                          <p className="text-xs text-muted-foreground">
                            {tests[def.id]!.hint}
                          </p>
                        )}
                        {tests[def.id]!.modelsSeen.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Models available:{" "}
                            <span className="font-mono">
                              {tests[def.id]!.modelsSeen.join(", ")}
                            </span>
                          </p>
                        )}
                      </div>
                    )}

                    {def.id === "local" && data.envCustomAi.baseUrl && (
                      <p className="text-xs text-muted-foreground">
                        Deploy env <code>CUSTOM_AI_BASE_URL={data.envCustomAi.baseUrl}</code>{" "}
                        is used when the base URL above is blank.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cloud default</CardTitle>
                <CardDescription>
                  Which cloud engine handles features set to “Cloud default” (and any
                  auto-fallback from a failed local call).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="cloud-default">Cloud default engine</Label>
                  <Select
                    value={cloudDefault}
                    onValueChange={(v) => setCloudDefault(v as AiEngineId)}
                  >
                    <SelectTrigger id="cloud-default" className="w-[240px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {cloudEngines.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.label}
                          {data.availability[e.id].available ? "" : " (not configured)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                  >
                    {saveMutation.isPending ? "Saving…" : "Save engines"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => lovableMutation.mutate()}
                    // A key pasted into the Lovable card counts too, so a
                    // self-hosted deploy without LOVABLE_API_KEY isn't stuck.
                    disabled={
                      lovableMutation.isPending ||
                      !(data.hasLovableApiKey || data.config.engines.lovable.hasApiKey)
                    }
                  >
                    {lovableMutation.isPending ? "Switching…" : "Switch to Lovable AI"}
                  </Button>

                </div>
                <p className="text-xs text-muted-foreground">
                  “Switch to Lovable AI” makes Lovable AI the cloud default, clears the runtime
                  custom-AI overrides, and points every hosted-recommended feature area at
                  Lovable AI.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
